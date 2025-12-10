import { Room } from "colyseus.js";
import type { SchemaCallbackProxy } from "@colyseus/schema";
import type { MyRoomState } from "../../server/src/rooms/MyRoom";

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export interface PeerConnection {
  sessionId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  remoteStream: MediaStream | null;
}

export type WebRTCEventHandler = {
  onRemoteStream?: (sessionId: string, stream: MediaStream) => void;
  onDataChannelMessage?: (sessionId: string, data: string) => void;
  onDataChannelOpen?: (sessionId: string) => void;
  onPeerDisconnected?: (sessionId: string) => void;
  onLocalStreamStopped?: () => void;
};

export class WebRTCManager {
  private room: Room;
  private localStream: MediaStream | null = null;
  private peers: Map<string, PeerConnection> = new Map();
  private eventHandlers: WebRTCEventHandler;
  private $: SchemaCallbackProxy<MyRoomState>;

  constructor(room: Room, $: SchemaCallbackProxy<MyRoomState>, eventHandlers: WebRTCEventHandler = {}) {
    this.room = room;
    this.$ = $;
    this.eventHandlers = eventHandlers;
    this.setupRoomListeners();
  }

  private setupRoomListeners() {
    this.$(this.room.state).peers.onAdd((peer, sessionId) => {
      // Skip self
      if (sessionId === this.room.sessionId) {
        return;
      }

      console.log("Peer added:", peer.name, sessionId);

      // Create peer connection immediately (data channel always on)
      this.createPeerConnection(sessionId, true);
    });

    this.$(this.room.state).peers.onRemove((peer, sessionId) => {
      console.log("Peer removed:", peer.name, sessionId);
      this.removePeer(sessionId);
    });

    // Handle incoming offer
    this.room.onMessage("offer", async (message: { senderId: string; sdp: RTCSessionDescriptionInit }) => {
      console.log("Received offer from:", message.senderId);
      await this.handleOffer(message.senderId, message.sdp);
    });

    // Handle incoming answer
    this.room.onMessage("answer", async (message: { senderId: string; sdp: RTCSessionDescriptionInit }) => {
      console.log("Received answer from:", message.senderId);
      const peer = this.peers.get(message.senderId);
      if (peer) {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(message.sdp));
      }
    });

    // Handle incoming ICE candidate
    this.room.onMessage("ice-candidate", async (message: { senderId: string; candidate: RTCIceCandidateInit }) => {
      const peer = this.peers.get(message.senderId);
      if (peer && message.candidate) {
        await peer.connection.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
    });
  }

  async startLocalStream(constraints: MediaStreamConstraints = { video: true, audio: true }): Promise<MediaStream> {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("Local stream ready:", {
        tracks: this.localStream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled }))
      });

      // Add tracks to all existing peer connections and renegotiate
      await this.addTracksToAllPeers();

      return this.localStream;
    } catch (error) {
      console.error("Error accessing media devices:", error);
      throw error;
    }
  }

  async stopLocalStream(): Promise<void> {
    if (!this.localStream) {
      return;
    }

    // Stop all tracks
    this.localStream.getTracks().forEach((track) => track.stop());

    // Remove tracks from all peer connections and renegotiate
    for (const [peerId, peer] of this.peers) {
      const senders = peer.connection.getSenders();
      for (const sender of senders) {
        if (sender.track) {
          peer.connection.removeTrack(sender);
        }
      }

      // Renegotiate with this peer
      await this.renegotiate(peerId, peer);
    }

    this.localStream = null;
    this.eventHandlers.onLocalStreamStopped?.();
  }

  private async addTracksToAllPeers(): Promise<void> {
    if (!this.localStream) {
      return;
    }

    for (const [peerId, peer] of this.peers) {
      const tracks = this.localStream.getTracks();
      console.log(`Adding ${tracks.length} tracks to existing connection with ${peerId}`);

      for (const track of tracks) {
        peer.connection.addTrack(track, this.localStream);
      }

      // Renegotiate with this peer
      await this.renegotiate(peerId, peer);
    }
  }

  private async renegotiate(peerId: string, peer: PeerConnection): Promise<void> {
    try {
      const offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);

      this.room.send("offer", {
        targetId: peerId,
        sdp: peer.connection.localDescription,
      });
    } catch (error) {
      console.error(`Error renegotiating with ${peerId}:`, error);
    }
  }

  isStreamingMedia(): boolean {
    return this.localStream !== null;
  }

  private async createPeerConnection(peerId: string, isInitiator: boolean): Promise<PeerConnection> {
    console.log(`Creating peer connection with ${peerId}, isInitiator: ${isInitiator}`);

    const connection = new RTCPeerConnection(ICE_SERVERS);
    const peerData: PeerConnection = {
      sessionId: peerId,
      connection,
      dataChannel: null,
      remoteStream: null,
    };

    // Add local stream tracks to the connection if available
    if (this.localStream) {
      const tracks = this.localStream.getTracks();
      console.log(`Adding ${tracks.length} local tracks to connection with ${peerId}:`,
        tracks.map(t => ({ kind: t.kind, enabled: t.enabled }))
      );
      tracks.forEach((track) => {
        connection.addTrack(track, this.localStream!);
      });
    } else {
      console.log("No local stream - creating data-channel-only connection");
    }

    // Handle ICE candidates
    connection.onicecandidate = (event) => {
      if (event.candidate) {
        this.room.send("ice-candidate", {
          targetId: peerId,
          candidate: event.candidate.toJSON(),
        });
      }
    };

    // Handle incoming tracks (remote stream)
    connection.ontrack = (event) => {
      console.log(`Received remote track from ${peerId}:`, {
        kind: event.track.kind,
        enabled: event.track.enabled,
        readyState: event.track.readyState,
        streams: event.streams.length,
      });

      if (event.streams[0]) {
        peerData.remoteStream = event.streams[0];
        this.eventHandlers.onRemoteStream?.(peerId, event.streams[0]);
      } else {
        console.warn("No stream in ontrack event!");
      }
    };

    // Handle connection state changes
    connection.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}: ${connection.connectionState}`);
      if (connection.connectionState === "disconnected" || connection.connectionState === "failed") {
        this.removePeer(peerId);
      }
    };

    // Handle ICE connection state (more granular)
    connection.oniceconnectionstatechange = () => {
      console.log(`ICE connection state with ${peerId}: ${connection.iceConnectionState}`);
    };

    // Handle signaling state
    connection.onsignalingstatechange = () => {
      console.log(`Signaling state with ${peerId}: ${connection.signalingState}`);
    };

    // If we're the initiator, create and send an offer
    if (isInitiator) {
      // Create data channel (only initiator creates it)
      const dataChannel = connection.createDataChannel("data", { ordered: true });
      this.setupDataChannel(dataChannel, peerId, peerData);

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      this.room.send("offer", {
        targetId: peerId,
        sdp: connection.localDescription,
      });
    } else {
      // Non-initiator handles incoming data channel
      connection.ondatachannel = (event) => {
        this.setupDataChannel(event.channel, peerId, peerData);
      };
    }

    this.peers.set(peerId, peerData);
    return peerData;
  }

  private setupDataChannel(dataChannel: RTCDataChannel, peerId: string, peerData: PeerConnection) {
    peerData.dataChannel = dataChannel;

    dataChannel.onopen = () => {
      console.log(`Data channel opened with ${peerId}`);
      this.eventHandlers.onDataChannelOpen?.(peerId);
    };

    dataChannel.onmessage = (event) => {
      console.log(`Data channel message from ${peerId}:`, event.data);
      this.eventHandlers.onDataChannelMessage?.(peerId, event.data);
    };

    dataChannel.onerror = (error) => {
      console.error(`Data channel error with ${peerId}:`, error);
    };

    dataChannel.onclose = () => {
      console.log(`Data channel closed with ${peerId}`);
    };
  }

  private async handleOffer(senderId: string, sdp: RTCSessionDescriptionInit) {
    // Check if we already have a connection to this peer
    let peerData = this.peers.get(senderId);

    if (peerData) {
      // Connection already exists - this shouldn't happen with proper sessionId ordering
      console.warn(`Already have connection to ${senderId}, state: ${peerData.connection.signalingState}`);
      // If in stable state, it might be a renegotiation - handle it
      if (peerData.connection.signalingState === "stable") {
        await peerData.connection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peerData.connection.createAnswer();
        await peerData.connection.setLocalDescription(answer);
        this.room.send("answer", {
          targetId: senderId,
          sdp: peerData.connection.localDescription,
        });
      }
      return;
    }

    peerData = await this.createPeerConnection(senderId, false);
    await peerData.connection.setRemoteDescription(new RTCSessionDescription(sdp));

    const answer = await peerData.connection.createAnswer();
    await peerData.connection.setLocalDescription(answer);

    this.room.send("answer", {
      targetId: senderId,
      sdp: peerData.connection.localDescription,
    });
  }

  private removePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.connection.close();
      peer.dataChannel?.close();
      this.peers.delete(peerId);
      this.eventHandlers.onPeerDisconnected?.(peerId);
    }
  }

  sendData(peerId: string, data: string) {
    const peer = this.peers.get(peerId);
    if (peer?.dataChannel?.readyState === "open") {
      peer.dataChannel.send(data);
    }
  }

  broadcast(data: string) {
    this.peers.forEach((peer) => {
      if (peer.dataChannel?.readyState === "open") {
        peer.dataChannel.send(data);
      }
    });
  }

  getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  getPeers(): Map<string, PeerConnection> {
    return this.peers;
  }

  disconnect() {
    this.peers.forEach((_, peerId) => {
      this.removePeer(peerId);
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
    }
  }
}

import { Room, Client } from "@colyseus/core";
import { schema, SchemaType } from "@colyseus/schema";

export const Position = schema({
  x: "number",
  y: "number"
});

export const Peer = schema({
  sessionId: "string",
  name: "string",
  position: { type: Position }
});

export const MyRoomState = schema({
  peers: { map: Peer }
});
export type MyRoomState = SchemaType<typeof MyRoomState>;

export class MyRoom extends Room {
  maxClients = 4;
  state = new MyRoomState();

  onCreate(options: any) {
    // Handle WebRTC signaling messages
    this.onMessage("offer", (client, message: { targetId: string; sdp: RTCSessionDescriptionInit }) => {
      console.log("Received offer from", client.sessionId, "to", message.targetId);
      // Relay offer to the target peer
      const targetClient = this.clients.find(c => c.sessionId === message.targetId);
      if (targetClient) {
        targetClient.send("offer", {
          senderId: client.sessionId,
          sdp: message.sdp,
        });
      }
    });

    this.onMessage("answer", (client, message: { targetId: string; sdp: RTCSessionDescriptionInit }) => {
      console.log("Received answer from", client.sessionId, "to", message.targetId);
      // Relay answer to the target peer
      const targetClient = this.clients.find(c => c.sessionId === message.targetId);
      if (targetClient) {
        targetClient.send("answer", {
          senderId: client.sessionId,
          sdp: message.sdp,
        });
      }
    });

    this.onMessage("ice-candidate", (client, message: { targetId: string; candidate: RTCIceCandidateInit }) => {
      console.log("Received ICE candidate from", client.sessionId, "to", message.targetId);
      // Relay ICE candidate to the target peer
      const targetClient = this.clients.find(c => c.sessionId === message.targetId);
      if (targetClient) {
        targetClient.send("ice-candidate", {
          senderId: client.sessionId,
          candidate: message.candidate,
        });
      }
    });
  }

  onJoin(client: Client, options: { name?: string }) {
    console.log(client.sessionId, "joined!");

    // Add peer to state (triggers onAdd on clients via schema sync)
    const peer = new Peer();
    peer.sessionId = client.sessionId;
    peer.name = options.name || `User ${client.sessionId.substring(0, 4)}`;
    this.state.peers.set(client.sessionId, peer);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left!");

    // Remove peer from state (triggers onRemove on clients via schema sync)
    this.state.peers.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }
}

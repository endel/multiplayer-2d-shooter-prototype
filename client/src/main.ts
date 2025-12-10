import "./style.css";
import { Client, getStateCallbacks } from "colyseus.js";
import { schema, Reflection, Encoder } from "@colyseus/schema";
import { WebRTCManager } from "./webrtc";

const Player = schema({
  name: "string",
  x: "number",
  y: "number"
})

const State = schema({
  players: { map: Player }
})

const state = new State();
const reflectionEncoder = new Encoder(state);
const reflection = Reflection.encode(reflectionEncoder);
console.log(reflection);

const client = new Client("ws://localhost:2567");

const room = await client.joinOrCreate("my_room", {
  schemaVersion: 1
})

// let webrtcManager: WebRTCManager | null = null;

// // DOM Elements
// const joinButton = document.getElementById("join-btn") as HTMLButtonElement;
// const leaveButton = document.getElementById("leave-btn") as HTMLButtonElement;
// const toggleMediaButton = document.getElementById("toggle-media-btn") as HTMLButtonElement;
// const localVideo = document.getElementById("local-video") as HTMLVideoElement;
// const remoteVideosContainer = document.getElementById("remote-videos") as HTMLDivElement;
// const messageInput = document.getElementById("message-input") as HTMLInputElement;
// const sendButton = document.getElementById("send-btn") as HTMLButtonElement;
// const chatMessages = document.getElementById("chat-messages") as HTMLDivElement;
// const statusEl = document.getElementById("status") as HTMLDivElement;

// function setStatus(message: string) {
//   statusEl.textContent = message;
//   console.log("Status:", message);
// }

// function addChatMessage(sender: string, message: string) {
//   const msgEl = document.createElement("div");
//   msgEl.className = "chat-message";
//   msgEl.innerHTML = `<strong>${sender}:</strong> ${message}`;
//   chatMessages.appendChild(msgEl);
//   chatMessages.scrollTop = chatMessages.scrollHeight;
// }

// function getOrCreateRemoteVideo(sessionId: string): HTMLVideoElement {
//   // Check if video already exists
//   const existing = document.getElementById(`video-${sessionId}`) as HTMLVideoElement;
//   if (existing) {
//     return existing;
//   }

//   const container = document.createElement("div");
//   container.className = "video-container";
//   container.id = `video-container-${sessionId}`;

//   const video = document.createElement("video");
//   video.id = `video-${sessionId}`;
//   video.autoplay = true;
//   video.playsInline = true;
//   // IMPORTANT: muted is required for autoplay to work in most browsers
//   video.muted = true;

//   const label = document.createElement("div");
//   label.className = "video-label";
//   label.textContent = sessionId.substring(0, 8);

//   // Add unmute button
//   const unmuteBtn = document.createElement("button");
//   unmuteBtn.className = "unmute-btn";
//   unmuteBtn.textContent = "🔇 Unmute";
//   unmuteBtn.onclick = () => {
//     video.muted = !video.muted;
//     unmuteBtn.textContent = video.muted ? "🔇 Unmute" : "🔊 Mute";
//   };

//   container.appendChild(video);
//   container.appendChild(label);
//   container.appendChild(unmuteBtn);
//   remoteVideosContainer.appendChild(container);

//   return video;
// }

// function removeRemoteVideo(sessionId: string) {
//   const container = document.getElementById(`video-container-${sessionId}`);
//   container?.remove();
// }

// async function joinRoom() {
//   try {
//     setStatus("Joining room...");

//     const room = await client.joinOrCreate("my_room", {
//       name: `User ${Math.floor(Math.random() * 1000)}`,
//     });

//     const $ = getStateCallbacks(room);

//     setStatus(`Joined room ${room.roomId} as ${room.sessionId}`);

//     // Initialize WebRTC manager
//     webrtcManager = new WebRTCManager(room, $, {
//       onRemoteStream: (sessionId, stream) => {
//         console.log(`Received stream from ${sessionId}`, {
//           tracks: stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, readyState: t.readyState }))
//         });
//         setStatus(`Received stream from ${sessionId} (${stream.getTracks().length} tracks)`);

//         const video = getOrCreateRemoteVideo(sessionId);
//         video.srcObject = stream;

//         // Explicitly play (required by some browsers)
//         video.play().catch(err => {
//           console.warn("Autoplay failed, user interaction required:", err);
//         });
//       },
//       onDataChannelMessage: (sessionId, data) => {
//         addChatMessage(sessionId.substring(0, 8), data);
//       },
//       onDataChannelOpen: (sessionId) => {
//         setStatus(`Data channel opened with ${sessionId}`);
//       },
//       onPeerDisconnected: (sessionId) => {
//         setStatus(`Peer disconnected: ${sessionId}`);
//         removeRemoteVideo(sessionId);
//       },
//       onLocalStreamStopped: () => {
//         localVideo.srcObject = null;
//         updateMediaButtonState();
//       },
//     });

//     setStatus("Connected. Data channel ready. Click 'Share Video/Audio' to stream.");

//     // Handle room state changes (for UI status only - WebRTCManager handles connections)
//     $(room.state).peers.onAdd((peer, sessionId) => {
//       if (sessionId !== room.sessionId) {
//         setStatus(`Peer joined: ${peer.name}`);
//       }
//     });

//     $(room.state).peers.onRemove((peer, sessionId) => {
//       if (sessionId !== room.sessionId) {
//         setStatus(`Peer removed: ${peer.name}`);
//       }
//     });

//     // Handle room leave
//     room.onLeave(() => {
//       setStatus("Disconnected from room");
//       cleanup();
//     });

//     // Update UI
//     joinButton.disabled = true;
//     leaveButton.disabled = false;
//     toggleMediaButton.disabled = false;
//     messageInput.disabled = false;
//     sendButton.disabled = false;
//     updateMediaButtonState();

//   } catch (error) {
//     console.error("Error joining room:", error);
//     setStatus(`Error: ${error}`);
//   }
// }

// function cleanup() {
//   webrtcManager?.disconnect();
//   webrtcManager = null;

//   localVideo.srcObject = null;
//   remoteVideosContainer.innerHTML = "";

//   joinButton.disabled = false;
//   leaveButton.disabled = true;
//   toggleMediaButton.disabled = true;
//   messageInput.disabled = true;
//   sendButton.disabled = true;
//   updateMediaButtonState();
// }

// function updateMediaButtonState() {
//   if (webrtcManager?.isStreamingMedia()) {
//     toggleMediaButton.textContent = "🚫 Stop Sharing";
//   } else {
//     toggleMediaButton.textContent = "📹 Share Video/Audio";
//   }
// }

// async function toggleMedia() {
//   if (!webrtcManager) return;

//   try {
//     if (webrtcManager.isStreamingMedia()) {
//       setStatus("Stopping media stream...");
//       await webrtcManager.stopLocalStream();
//       localVideo.srcObject = null;
//       setStatus("Media sharing stopped.");
//     } else {
//       setStatus("Requesting camera/microphone access...");
//       const localStream = await webrtcManager.startLocalStream();
//       localVideo.srcObject = localStream;
//       setStatus("Now sharing video/audio.");
//     }
//     updateMediaButtonState();
//   } catch (error) {
//     console.error("Error toggling media:", error);
//     setStatus(`Error: ${error}`);
//   }
// }

// async function leaveRoom() {
//   cleanup();
//   setStatus("Left the room");
// }

// function sendMessage() {
//   const message = messageInput.value.trim();
//   if (message && webrtcManager) {
//     webrtcManager.broadcast(message);
//     addChatMessage("You", message);
//     messageInput.value = "";
//   }
// }

// // Event listeners
// joinButton.addEventListener("click", joinRoom);
// leaveButton.addEventListener("click", leaveRoom);
// toggleMediaButton.addEventListener("click", toggleMedia);
// sendButton.addEventListener("click", sendMessage);
// messageInput.addEventListener("keypress", (e) => {
//   if (e.key === "Enter") {
//     sendMessage();
//   }
// });

// // Initial state
// leaveButton.disabled = true;
// toggleMediaButton.disabled = true;
// messageInput.disabled = true;
// sendButton.disabled = true;

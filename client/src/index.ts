import { Client, Room, getStateCallbacks } from "colyseus.js";
import { Renderer } from "./Renderer";
import type { PlayerRenderData, BulletRenderData } from "./Renderer";
import { ClientPrediction, EntityInterpolator } from "./ClientPrediction";
import { InputHandler } from "./InputHandler";
import { TICK_RATE, PLAYER_RADIUS, BULLET_RADIUS } from "./types";
import type { InputState, KillMessage } from "./types";
import { playGunshot, playHit } from "./audio";
import type { GameState } from "../../server/src/rooms/BattleRoyaleRoom";

class BattleRoyaleGame {
  private client: Client;
  private room: Room<GameState> | null = null;
  private renderer: Renderer;
  private prediction: ClientPrediction;
  private inputHandler: InputHandler | null = null;

  // State tracking
  private localPlayerId: string | null = null;
  private localPlayerAngle = 0;
  private otherPlayerInterpolators: Map<string, EntityInterpolator> = new Map();

  // Predicted local position (for rendering)
  private predictedX = 0;
  private predictedY = 0;

  // Bullet spawn times for client-side position prediction
  private bulletSpawnTimes: Map<string, number> = new Map();
  // Track bullets that already triggered a local hit reaction
  private acknowledgedBulletHits: Set<string> = new Set();

  // Ping tracking
  private pingSentAt: number = 0;

  constructor() {
    if (window.location.hostname === "localhost") {
      this.client = new Client("ws://localhost:2567");
    } else {
      this.client = new Client("https://cl-scl-244a43e6.colyseus.cloud");
    }

    this.renderer = new Renderer();
    this.prediction = new ClientPrediction();
  }

  async start() {
    // Initialize renderer
    const container = document.getElementById("game-container");
    if (!container) {
      throw new Error("Game container not found");
    }
    await this.renderer.init(container);

    // Connect to server
    try {
      this.room = await this.client.joinOrCreate("battle_royale");
      this.localPlayerId = this.room.sessionId;
      this.renderer.setLocalPlayer(this.localPlayerId);

      console.log("Joined room:", this.room.roomId, "as", this.localPlayerId);

      // Setup state callbacks
      this.setupStateCallbacks();

      // Setup input handler
      this.inputHandler = new InputHandler(
        this.renderer.getCanvas(),
        (input) => this.handleInput(input),
        (angle) => this.handleShoot(angle)
      );
      this.inputHandler.startInputLoop(TICK_RATE);

      // Start game loop
      this.gameLoop();

    } catch (error) {
      console.error("Failed to join room:", error);
      this.showConnectionError(error);
      throw error;
    }
  }

  private setupStateCallbacks() {
    if (!this.room) return;

    const $ = getStateCallbacks(this.room);

    // Player added
    $(this.room.state).players.onAdd((_player: any, sessionId: string) => {
      console.log("Player joined:", sessionId);

      if (sessionId === this.localPlayerId) {
        // Initialize local player prediction
        const playerState = this.room!.state.players.get(sessionId) as any;
        this.prediction.initPlayer(playerState.x, playerState.y);
        this.predictedX = playerState.x;
        this.predictedY = playerState.y;
      } else {
        // Create interpolator for other players
        const playerState = this.room!.state.players.get(sessionId) as any;
        const interpolator = new EntityInterpolator();
        interpolator.addSnapshot(playerState.x, playerState.y, playerState.angle);
        this.otherPlayerInterpolators.set(sessionId, interpolator);
      }
    });

    // Player removed
    $(this.room.state).players.onRemove((_player: any, sessionId: string) => {
      console.log("Player left:", sessionId);
      this.otherPlayerInterpolators.delete(sessionId);
    });

    // Listen for kill events
    this.room.onMessage("kill", (message: KillMessage) => {
      console.log("Kill:", message);
      const killerName = message.killerId.substring(0, 6);
      const targetName = message.targetId.substring(0, 6);

      if (message.targetId === this.localPlayerId) {
        this.renderer.showKillFeed(`You were killed by ${killerName}`);
      } else if (message.killerId === this.localPlayerId) {
        this.renderer.showKillFeed(`You killed ${targetName}`);
      } else {
        this.renderer.showKillFeed(`${killerName} killed ${targetName}`);
      }
    });

    const pingInterval = setInterval(() => {
      this.pingSentAt = performance.now();
      this.room?.send("ping");
    }, 2000);
    this.room.onLeave(() => clearInterval(pingInterval));
    this.room.onMessage("ping", () => {
      const rtt = performance.now() - this.pingSentAt;
      this.renderer.updatePing(rtt);
    });

  }


  private handleInput(input: InputState) {
    if (!this.room) return;

    // Store angle for rendering
    this.localPlayerAngle = input.angle;

    // Apply input locally for prediction
    const predicted = this.prediction.applyInput(input);
    this.predictedX = predicted.x;
    this.predictedY = predicted.y;

    // Send to server
    this.room.send("input", {
      seq: input.seq,
      keys: input.keys,
      angle: input.angle,
    });
  }

  private handleShoot(angle: number) {
    if (!this.room) return;

    this.room.send("shoot", { angle });
    playGunshot(1, 'pistol');
  }

  private gameLoop = () => {
    if (!this.room || !this.room.state.players) {
      requestAnimationFrame(this.gameLoop);
      return;
    }

    // Update other player interpolators with latest server state
    for (const [sessionId, player] of this.room.state.players) {
      if (sessionId === this.localPlayerId) {
        // Reconcile local player with server state
        const serverPlayer = player as any;
        if (serverPlayer.lastProcessedSeq > 0) {
          const reconciled = this.prediction.reconcile(
            serverPlayer.x,
            serverPlayer.y,
            serverPlayer.lastProcessedSeq
          );
          this.predictedX = reconciled.x;
          this.predictedY = reconciled.y;
        }
      } else {
        // Update interpolator for other players
        const interpolator = this.otherPlayerInterpolators.get(sessionId);
        if (interpolator) {
          const p = player as any;
          interpolator.addSnapshot(p.x, p.y, p.angle);
        }
      }
    }

    // Build render data for players
    const playerRenderData = new Map<string, PlayerRenderData>();

    for (const [sessionId, player] of this.room.state.players) {
      const p = player as any;
      const isLocal = sessionId === this.localPlayerId;

      let x: number, y: number, angle: number;

      if (isLocal) {
        // Use predicted position for local player
        x = this.predictedX;
        y = this.predictedY;
        angle = this.localPlayerAngle;
      } else {
        // Use interpolated position for other players
        const interpolator = this.otherPlayerInterpolators.get(sessionId);
        const interpolated = interpolator?.getInterpolatedState();
        if (interpolated) {
          x = interpolated.x;
          y = interpolated.y;
          angle = interpolated.angle;
        } else {
          x = p.x;
          y = p.y;
          angle = p.angle;
        }
      }

      playerRenderData.set(sessionId, {
        x,
        y,
        angle,
        health: p.health,
        isLocal,
        isDead: p.health <= 0,
      });
    }

    // Build render data for bullets with client-side position prediction
    const bulletRenderData = new Map<string, BulletRenderData>();
    const currentBulletIds = new Set<string>();

    const localPlayerState = this.localPlayerId
      ? (this.room.state.players.get(this.localPlayerId) as any)
      : null;

    for (const [bulletId, bullet] of this.room.state.bullets) {
      currentBulletIds.add(bulletId);

      // Track spawn time when bullet first appears
      if (!this.bulletSpawnTimes.has(bulletId)) {
        this.bulletSpawnTimes.set(bulletId, performance.now());
      }

      // Calculate predicted position based on spawn position + trajectory
      const spawnTime = this.bulletSpawnTimes.get(bulletId)!;
      const elapsedSeconds = (performance.now() - spawnTime) / 1000;
      const predictedX = bullet.x + Math.cos(bullet.angle) * bullet.speed * elapsedSeconds;
      const predictedY = bullet.y + Math.sin(bullet.angle) * bullet.speed * elapsedSeconds;

      // Client-side hit detection
      if (this.localPlayerId && !this.acknowledgedBulletHits.has(bulletId)) {
        const hitRadius = PLAYER_RADIUS + BULLET_RADIUS;

        if (bullet.ownerId !== this.localPlayerId) {
          // Enemy bullet hitting local player
          if (localPlayerState && localPlayerState.health > 0) {
            const dx = predictedX - this.predictedX;
            const dy = predictedY - this.predictedY;
            const distance = Math.hypot(dx, dy);

            if (distance < hitRadius) {
              this.acknowledgedBulletHits.add(bulletId);
              playHit(1);
              this.renderer.flashHit();
            }
          }
        } else {
          // Local player's bullet hitting other players
          for (const [sessionId, player] of this.room.state.players) {
            if (sessionId === this.localPlayerId) continue;
            const p = player as any;
            if (p.health <= 0) continue;

            // Get interpolated position for other players
            const interpolator = this.otherPlayerInterpolators.get(sessionId);
            const interpolated = interpolator?.getInterpolatedState();
            const targetX = interpolated?.x ?? p.x;
            const targetY = interpolated?.y ?? p.y;

            const dx = predictedX - targetX;
            const dy = predictedY - targetY;
            const distance = Math.hypot(dx, dy);

            if (distance < hitRadius) {
              this.acknowledgedBulletHits.add(bulletId);
              playHit(1);
              break;
            }
          }
        }
      }

      // Don't render bullets that have hit the local player
      if (this.acknowledgedBulletHits.has(bulletId)) {
        continue;
      }

      bulletRenderData.set(bulletId, {
        x: predictedX,
        y: predictedY,
      });
    }

    // Clean up spawn times for bullets that no longer exist
    for (const bulletId of this.bulletSpawnTimes.keys()) {
      if (!currentBulletIds.has(bulletId)) {
        this.bulletSpawnTimes.delete(bulletId);
        this.acknowledgedBulletHits.delete(bulletId);
      }
    }

    // Update camera to follow local player
    this.inputHandler?.updateCamera(this.predictedX, this.predictedY);
    this.renderer.updateCamera(this.predictedX, this.predictedY);

    // Update health UI
    if (localPlayerState) {
      this.renderer.updateUI((localPlayerState as any).health);
    }

    // Render
    this.renderer.updatePlayers(playerRenderData);
    this.renderer.updateBullets(bulletRenderData);

    requestAnimationFrame(this.gameLoop);
  };

  private showConnectionError(error: unknown) {
    const loading = document.getElementById("loading");
    if (!loading) return;

    loading.classList.remove("hidden");
    loading.classList.add("error");

    const status = loading.querySelector(".status");
    if (status) {
      status.textContent = "Connection Failed";
    }

    const errorMessage = loading.querySelector(".error-message");
    if (errorMessage) {
      const message =  error instanceof Error ? error.message : String(error);
      errorMessage.textContent = message;
    }

    // Add retry button
    const existingBtn = loading.querySelector(".retry-btn");
    if (!existingBtn) {
      const retryBtn = document.createElement("button");
      retryBtn.className = "retry-btn";
      retryBtn.textContent = "Retry";
      retryBtn.onclick = () => window.location.reload();
      loading.appendChild(retryBtn);
    }
  }

  destroy() {
    this.inputHandler?.destroy();
    this.renderer.destroy();
    this.room?.leave();
  }
}

// Start game
async function main() {
  const game = new BattleRoyaleGame();
  await game.start();

  console.log("Battle Royale started! WASD to move, mouse to aim, click to shoot.");
}

main().catch(console.error);

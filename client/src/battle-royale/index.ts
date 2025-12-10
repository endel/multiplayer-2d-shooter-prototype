import { Client, Room, getStateCallbacks } from "colyseus.js";
import { Renderer } from "./Renderer";
import type { PlayerRenderData, BulletRenderData } from "./Renderer";
import { ClientPrediction, EntityInterpolator } from "./ClientPrediction";
import { InputHandler } from "./InputHandler";
import { TICK_RATE } from "./types";
import type { InputState, HitMessage, KillMessage } from "./types";

class BattleRoyaleGame {
  private client: Client;
  private room: Room | null = null;
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

  constructor() {
    this.client = new Client("ws://localhost:2567");
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

    // Listen for hit events
    this.room.onMessage("hit", (message: HitMessage) => {
      console.log("Hit:", message);
      if (message.targetId === this.localPlayerId) {
        // We got hit - update UI
        this.renderer.updateUI(message.health);
      }
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

    // Build render data for bullets
    const bulletRenderData = new Map<string, BulletRenderData>();
    for (const [bulletId, bullet] of this.room.state.bullets) {
      const b = bullet as any;
      bulletRenderData.set(bulletId, {
        x: b.x,
        y: b.y,
      });
    }

    // Update camera to follow local player
    this.inputHandler?.updateCamera(this.predictedX, this.predictedY);
    this.renderer.updateCamera(this.predictedX, this.predictedY);

    // Update health UI
    const localPlayer = this.room.state.players.get(this.localPlayerId!);
    if (localPlayer) {
      this.renderer.updateUI((localPlayer as any).health);
    }

    // Render
    this.renderer.updatePlayers(playerRenderData);
    this.renderer.updateBullets(bulletRenderData);

    requestAnimationFrame(this.gameLoop);
  };

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

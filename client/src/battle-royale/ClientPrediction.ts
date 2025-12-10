import RAPIER from "@dimforge/rapier2d";
import { PLAYER_RADIUS, PLAYER_SPEED, MAP_SIZE } from "./types";
import type { InputState } from "./types";

export interface PredictedState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

export class ClientPrediction {
  private world: RAPIER.World;
  private playerBody: RAPIER.RigidBody | null = null;
  
  // Input history for reconciliation
  private inputHistory: InputState[] = [];
  private maxHistorySize = 120; // ~2 seconds at 60Hz
  

  constructor() {
    // Create physics world (no gravity for top-down)
    const gravity = { x: 0, y: 0 };
    this.world = new RAPIER.World(gravity);
    
    // Create map boundaries
    this.createMapBoundaries();
  }

  private createMapBoundaries() {
    const wallThickness = 50;
    const halfSize = MAP_SIZE / 2;

    const walls = [
      { x: 0, y: -halfSize - wallThickness / 2, hw: halfSize + wallThickness, hh: wallThickness / 2 },
      { x: 0, y: halfSize + wallThickness / 2, hw: halfSize + wallThickness, hh: wallThickness / 2 },
      { x: -halfSize - wallThickness / 2, y: 0, hw: wallThickness / 2, hh: halfSize + wallThickness },
      { x: halfSize + wallThickness / 2, y: 0, hw: wallThickness / 2, hh: halfSize + wallThickness },
    ];

    for (const wall of walls) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, wall.y);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(wall.hw, wall.hh);
      this.world.createCollider(colliderDesc, body);
    }
  }

  initPlayer(x: number, y: number) {
    if (this.playerBody) {
      this.world.removeRigidBody(this.playerBody);
    }

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setLinearDamping(10);
    
    this.playerBody = this.world.createRigidBody(bodyDesc);
    
    const colliderDesc = RAPIER.ColliderDesc.ball(PLAYER_RADIUS)
      .setDensity(1)
      .setFriction(0)
      .setRestitution(0);
    
    this.world.createCollider(colliderDesc, this.playerBody);
  }

  /**
   * Apply input locally for immediate feedback
   */
  applyInput(input: InputState): PredictedState {
    if (!this.playerBody) {
      return { x: 0, y: 0, velocityX: 0, velocityY: 0 };
    }

    // Store input in history
    this.inputHistory.push(input);
    if (this.inputHistory.length > this.maxHistorySize) {
      this.inputHistory.shift();
    }

    // Calculate movement direction
    let dx = 0;
    let dy = 0;
    
    if (input.keys.w) dy -= 1;
    if (input.keys.s) dy += 1;
    if (input.keys.a) dx -= 1;
    if (input.keys.d) dx += 1;

    // Normalize diagonal movement
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0) {
      dx = (dx / length) * PLAYER_SPEED;
      dy = (dy / length) * PLAYER_SPEED;
    }

    // Apply velocity
    this.playerBody.setLinvel({ x: dx, y: dy }, true);

    // Step physics
    this.world.step();

    // Return predicted state
    const pos = this.playerBody.translation();
    const vel = this.playerBody.linvel();
    
    return {
      x: pos.x,
      y: pos.y,
      velocityX: vel.x,
      velocityY: vel.y,
    };
  }

  /**
   * Reconcile with server state
   * Called when we receive authoritative state from server
   */
  reconcile(serverX: number, serverY: number, serverSeq: number): PredictedState {
    if (!this.playerBody) {
      return { x: serverX, y: serverY, velocityX: 0, velocityY: 0 };
    }

    // Server has processed up to this sequence

    // Snap to server position
    this.playerBody.setTranslation({ x: serverX, y: serverY }, true);
    this.playerBody.setLinvel({ x: 0, y: 0 }, true);

    // Remove inputs that server has already processed
    this.inputHistory = this.inputHistory.filter(input => input.seq > serverSeq);

    // Re-apply unacknowledged inputs
    for (const input of this.inputHistory) {
      let dx = 0;
      let dy = 0;
      
      if (input.keys.w) dy -= 1;
      if (input.keys.s) dy += 1;
      if (input.keys.a) dx -= 1;
      if (input.keys.d) dx += 1;

      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > 0) {
        dx = (dx / length) * PLAYER_SPEED;
        dy = (dy / length) * PLAYER_SPEED;
      }

      this.playerBody.setLinvel({ x: dx, y: dy }, true);
      this.world.step();
    }

    const pos = this.playerBody.translation();
    const vel = this.playerBody.linvel();
    
    return {
      x: pos.x,
      y: pos.y,
      velocityX: vel.x,
      velocityY: vel.y,
    };
  }

  /**
   * Get current predicted position
   */
  getPosition(): { x: number; y: number } {
    if (!this.playerBody) {
      return { x: 0, y: 0 };
    }
    const pos = this.playerBody.translation();
    return { x: pos.x, y: pos.y };
  }

  /**
   * Clear input history (e.g., on respawn)
   */
  clearHistory() {
    this.inputHistory = [];
  }

  destroy() {
    // Rapier cleanup handled automatically
  }
}

/**
 * Interpolator for smoothly rendering other players
 */
export class EntityInterpolator {
  private buffer: { x: number; y: number; angle: number; timestamp: number }[] = [];
  private interpolationDelay = 100; // ms delay for smooth interpolation

  addSnapshot(x: number, y: number, angle: number) {
    const timestamp = Date.now();
    this.buffer.push({ x, y, angle, timestamp });

    // Keep only recent snapshots
    const cutoff = timestamp - 1000;
    this.buffer = this.buffer.filter(s => s.timestamp > cutoff);
  }

  getInterpolatedState(): { x: number; y: number; angle: number } | null {
    if (this.buffer.length < 2) {
      return this.buffer[0] || null;
    }

    const renderTime = Date.now() - this.interpolationDelay;

    // Find the two snapshots to interpolate between
    let older = this.buffer[0];
    let newer = this.buffer[1];

    for (let i = 1; i < this.buffer.length; i++) {
      if (this.buffer[i].timestamp > renderTime) {
        newer = this.buffer[i];
        older = this.buffer[i - 1];
        break;
      }
      older = this.buffer[i];
      newer = this.buffer[i];
    }

    // Calculate interpolation factor
    const range = newer.timestamp - older.timestamp;
    if (range === 0) {
      return newer;
    }

    const t = Math.max(0, Math.min(1, (renderTime - older.timestamp) / range));

    return {
      x: older.x + (newer.x - older.x) * t,
      y: older.y + (newer.y - older.y) * t,
      angle: this.lerpAngle(older.angle, newer.angle, t),
    };
  }

  private lerpAngle(a: number, b: number, t: number): number {
    // Handle angle wraparound
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}

import { Room, Client } from "@colyseus/core";
import { Encoder, schema, SchemaType } from "@colyseus/schema";
import RAPIER from "@dimforge/rapier2d-compat";

Encoder.BUFFER_SIZE = 64 * 1024; // 64KB

// Constants
const MAP_SIZE = 2000;
const PLAYER_RADIUS = 25;
const PLAYER_SPEED = 200;
const BULLET_RADIUS = 5;
const BULLET_SPEED = 1200;
const BULLET_DAMAGE = 20;
const STARTING_HEALTH = 500;
const TICK_RATE = 60;
const BULLET_MAX_DISTANCE = 1000;

// Schema definitions
export const Player = schema({
  x: "number",
  y: "number",
  angle: "number",
  health: "number",
  velocityX: "number",
  velocityY: "number",
  lastProcessedSeq: "number",
});
export type Player = SchemaType<typeof Player>;

export const Bullet = schema({
  ownerId: "string",
  x: "number",
  y: "number",
  angle: "number",
  speed: "number",
});
export type Bullet = SchemaType<typeof Bullet>;

export const GameState = schema({
  players: { map: Player },
  bullets: { map: Bullet },
});
export type GameState = SchemaType<typeof GameState>;

// Input message types
interface InputMessage {
  seq: number;
  keys: { w: boolean; a: boolean; s: boolean; d: boolean };
  angle: number;
}

interface ShootMessage {
  angle: number;
}

// Physics body user data
interface BodyUserData {
  type: "player" | "bullet" | "wall";
  id: string;
}

export class BattleRoyaleRoom extends Room {
  maxClients = 100;
  state = new GameState();

  private world!: RAPIER.World;
  private playerBodies: Map<string, RAPIER.RigidBody> = new Map();
  private bulletBodies: Map<string, RAPIER.RigidBody> = new Map();
  private bulletStartPositions: Map<string, { x: number; y: number }> = new Map();
  private bulletIdCounter = 0;
  private pendingInputs: Map<string, InputMessage[]> = new Map();
  private shootCooldowns: Map<string, number> = new Map();

  async onCreate(options: any) {
    // Initialize Rapier WASM
    await RAPIER.init();

    // Initialize Rapier physics world (no gravity for top-down)
    const gravity = { x: 0, y: 0 };
    this.world = new RAPIER.World(gravity);

    // Create map boundaries (walls)
    this.createMapBoundaries();

    // Handle player input
    this.onMessage("input", (client, message: InputMessage) => {
      const inputs = this.pendingInputs.get(client.sessionId) || [];
      inputs.push(message);
      this.pendingInputs.set(client.sessionId, inputs);
    });

    // Handle shooting
    this.onMessage("shoot", (client, message: ShootMessage) => {
      this.handleShoot(client.sessionId, message.angle);
    });

    // Start game loop at 60Hz
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);

    console.log("BattleRoyaleRoom created");
  }

  private createMapBoundaries() {
    const wallThickness = 50;
    const halfSize = MAP_SIZE / 2;

    // Create 4 walls around the map
    const walls = [
      { x: 0, y: -halfSize - wallThickness / 2, hw: halfSize + wallThickness, hh: wallThickness / 2 }, // Top
      { x: 0, y: halfSize + wallThickness / 2, hw: halfSize + wallThickness, hh: wallThickness / 2 },  // Bottom
      { x: -halfSize - wallThickness / 2, y: 0, hw: wallThickness / 2, hh: halfSize + wallThickness }, // Left
      { x: halfSize + wallThickness / 2, y: 0, hw: wallThickness / 2, hh: halfSize + wallThickness },  // Right
    ];

    for (const wall of walls) {
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, wall.y);
      const body = this.world.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(wall.hw, wall.hh);
      this.world.createCollider(colliderDesc, body);
    }
  }

  private createPlayerBody(sessionId: string, x: number, y: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setLinearDamping(10); // High damping for responsive stop

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(PLAYER_RADIUS)
      .setDensity(1)
      .setFriction(0)
      .setRestitution(0);

    this.world.createCollider(colliderDesc, body);

    return body;
  }

  private createBulletBody(x: number, y: number, angle: number): RAPIER.RigidBody {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y)
      .setLinvel(Math.cos(angle) * BULLET_SPEED, Math.sin(angle) * BULLET_SPEED)
      .setCcdEnabled(true); // Continuous collision detection for fast bullets

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(BULLET_RADIUS)
      .setDensity(0.1)
      .setSensor(true); // Bullets are sensors - they detect but don't push

    this.world.createCollider(colliderDesc, body);

    return body;
  }

  private handleShoot(sessionId: string, angle: number) {
    const player = this.state.players.get(sessionId);
    if (!player || player.health <= 0) return;

    // Check cooldown (200ms between shots)
    const now = Date.now();
    const lastShot = this.shootCooldowns.get(sessionId) || 0;
    if (now - lastShot < 200) return;
    this.shootCooldowns.set(sessionId, now);

    // Spawn bullet at player position, offset by player radius
    const spawnOffset = PLAYER_RADIUS + BULLET_RADIUS + 5;
    const bulletX = player.x + Math.cos(angle) * spawnOffset;
    const bulletY = player.y + Math.sin(angle) * spawnOffset;

    const bulletId = `${this.bulletIdCounter++}`;

    // Create physics body
    const body = this.createBulletBody(bulletX, bulletY, angle);
    this.bulletBodies.set(bulletId, body);
    this.bulletStartPositions.set(bulletId, { x: bulletX, y: bulletY });

    // Create state
    const bullet = new Bullet();
    bullet.ownerId = sessionId;
    bullet.x = bulletX;
    bullet.y = bulletY;
    bullet.angle = angle;
    bullet.speed = BULLET_SPEED;
    this.state.bullets.set(bulletId, bullet);
  }

  private update(deltaTime: number) {
    const dt = deltaTime / 1000; // Convert to seconds

    // Process all pending inputs
    for (const [sessionId, inputs] of this.pendingInputs) {
      const player = this.state.players.get(sessionId);
      const body = this.playerBodies.get(sessionId);

      if (!player || !body || player.health <= 0) continue;

      // Process each input
      for (const input of inputs) {
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

        // Apply velocity directly (with damping, it will stop when keys released)
        body.setLinvel({ x: dx, y: dy }, true);

        // Update angle
        player.angle = input.angle;
        player.lastProcessedSeq = input.seq;
      }
    }
    this.pendingInputs.clear();

    // Step physics
    this.world.step();

    // Sync player positions from physics
    for (const [sessionId, body] of this.playerBodies) {
      const player = this.state.players.get(sessionId);
      if (!player) continue;

      const pos = body.translation();
      const vel = body.linvel();

      player.x = pos.x;
      player.y = pos.y;
      player.velocityX = vel.x;
      player.velocityY = vel.y;
    }

    // Sync bullet positions and check collisions
    const bulletsToRemove: string[] = [];

    for (const [bulletId, body] of this.bulletBodies) {
      const bullet = this.state.bullets.get(bulletId);
      if (!bullet) continue;

      const pos = body.translation();
      // Bullet position is predicted client-side based on spawn position, angle, and speed
      // bullet.x and bullet.y remain as spawn positions

      // Check if bullet traveled too far
      const startPos = this.bulletStartPositions.get(bulletId);
      if (startPos) {
        const distTraveled = Math.sqrt(
          Math.pow(pos.x - startPos.x, 2) + Math.pow(pos.y - startPos.y, 2)
        );
        if (distTraveled > BULLET_MAX_DISTANCE) {
          bulletsToRemove.push(bulletId);
          continue;
        }
      }

      // Check bullet-player collisions manually (since bullets are sensors)
      for (const [sessionId, playerBody] of this.playerBodies) {
        // Don't hit own player
        if (sessionId === bullet.ownerId) continue;

        const playerPos = playerBody.translation();
        const dist = Math.sqrt(
          Math.pow(pos.x - playerPos.x, 2) + Math.pow(pos.y - playerPos.y, 2)
        );

        if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
          // Hit!
          const player = this.state.players.get(sessionId);
          if (player && player.health > 0) {
            player.health = Math.max(0, player.health - BULLET_DAMAGE);

            // // Notify about hit
            // this.broadcast("hit", {
            //   targetId: sessionId,
            //   shooterId: bullet.ownerId,
            //   damage: BULLET_DAMAGE,
            //   health: player.health
            // });

            if (player.health <= 0) {
              this.broadcast("kill", {
                targetId: sessionId,
                killerId: bullet.ownerId
              });
            }
          }
          bulletsToRemove.push(bulletId);
          break;
        }
      }

      // Check if bullet is out of bounds
      if (Math.abs(pos.x) > MAP_SIZE / 2 + 100 || Math.abs(pos.y) > MAP_SIZE / 2 + 100) {
        bulletsToRemove.push(bulletId);
      }
    }

    // Remove expired bullets
    for (const bulletId of bulletsToRemove) {
      this.removeBullet(bulletId);
    }
  }

  private removeBullet(bulletId: string) {
    // disable collision detection immediately
    const body = this.bulletBodies.get(bulletId);
    if (body) {
      this.world.removeRigidBody(body);
      this.bulletBodies.delete(bulletId);
    }
    this.bulletStartPositions.delete(bulletId);

    // remove bullet from state after 200ms (so client can render the hit)
    this.clock.setTimeout(() =>
      this.state.bullets.delete(bulletId), 200);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined BattleRoyaleRoom");

    // Random spawn position within map bounds (away from edges)
    const spawnMargin = 200;
    const spawnRange = MAP_SIZE / 2 - spawnMargin;
    const x = (Math.random() - 0.5) * 2 * spawnRange;
    const y = (Math.random() - 0.5) * 2 * spawnRange;

    // Create player state
    const player = new Player();
    player.x = x;
    player.y = y;
    player.angle = 0;
    player.health = STARTING_HEALTH;
    player.velocityX = 0;
    player.velocityY = 0;
    player.lastProcessedSeq = 0;
    this.state.players.set(client.sessionId, player);

    // Create physics body
    const body = this.createPlayerBody(client.sessionId, x, y);
    this.playerBodies.set(client.sessionId, body);

    // Initialize input queue
    this.pendingInputs.set(client.sessionId, []);
  }

  onLeave(client: Client, consented: boolean) {
    console.log(client.sessionId, "left BattleRoyaleRoom");

    // Remove physics body
    const body = this.playerBodies.get(client.sessionId);
    if (body) {
      this.world.removeRigidBody(body);
      this.playerBodies.delete(client.sessionId);
    }

    // Remove state
    this.state.players.delete(client.sessionId);
    this.pendingInputs.delete(client.sessionId);
    this.shootCooldowns.delete(client.sessionId);
  }

  onDispose() {
    console.log("BattleRoyaleRoom disposing...");
  }
}

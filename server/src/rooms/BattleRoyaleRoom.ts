import { Room, Client, Messages, CloseCode } from "@colyseus/core";
import { Encoder, Schema, type, MapSchema, StateView, view } from "@colyseus/schema";
import { Quadtree, Rectangle } from "@timohausmann/quadtree-ts";
import RAPIER from "@dimforge/rapier2d-compat";

Encoder.BUFFER_SIZE = 64 * 1024 // 64KB
  * 60; // 60 max players

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
const VIEW_DISTANCE = 600; // Visibility radius for StateView

// Schema definitions
export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") angle: number = 0;
  @type("number") health: number = 0;
  @type("number") velocityX: number = 0;
  @type("number") velocityY: number = 0;
  @type("number") lastProcessedSeq: number = 0;
}

export class Bullet extends Schema {
  @type("string") ownerId: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") angle: number = 0;
  @type("number") speed: number = 0;
}

export class GameState extends Schema {
  @view() @type({ map: Player }) players = new MapSchema<Player>();  // Only sync players in view
  @view() @type({ map: Bullet }) bullets = new MapSchema<Bullet>();  // Only sync bullets in view
}

// Input message types
export interface InputMessage {
  seq: number;
  keys: { w: boolean; a: boolean; s: boolean; d: boolean };
  angle: number;
}

export interface ShootMessage {
  angle: number;
}

// Physics body user data
interface BodyUserData {
  type: "player" | "bullet" | "wall";
  id: string;
}

export class BattleRoyaleRoom extends Room {
  maxClients = 300;
  state = new GameState();

  private world!: RAPIER.World;
  private playerBodies: Map<string, RAPIER.RigidBody> = new Map();
  private bulletBodies: Map<string, RAPIER.RigidBody> = new Map();
  private bulletStartPositions: Map<string, { x: number; y: number }> = new Map();
  private bulletIdCounter = 0;
  private pendingInputs: Map<string, InputMessage[]> = new Map();
  private shootCooldowns: Map<string, number> = new Map();

  // Quadtree for spatial partitioning
  private quadtree!: Quadtree<Rectangle<{ id: string }>>;
  private playerRects: Map<string, Rectangle<{ id: string }>> = new Map();
  private queryRect: Rectangle = new Rectangle({ x: 0, y: 0, width: VIEW_DISTANCE * 2, height: VIEW_DISTANCE * 2 });

  messages = {
    input: (client: Client, message: InputMessage) => {
      const inputs = this.pendingInputs.get(client.sessionId) || [];
      inputs.push(message);
      this.pendingInputs.set(client.sessionId, inputs);
    },
    shoot: (client: Client, message: ShootMessage) => {
      this.handleShoot(client.sessionId, message.angle);
    }
  };

  async onCreate(options: any) {
    // Initialize Rapier WASM
    await RAPIER.init();

    // Initialize Rapier physics world (no gravity for top-down)
    const gravity = { x: 0, y: 0 };
    this.world = new RAPIER.World(gravity);
    this.world.timestep = 1 / TICK_RATE;

    // Initialize quadtree for spatial partitioning
    this.quadtree = new Quadtree({
      width: MAP_SIZE,
      height: MAP_SIZE,
      x: -MAP_SIZE / 2,
      y: -MAP_SIZE / 2,
      maxObjects: 2,
    });

    // Create map boundaries (walls)
    this.createMapBoundaries();

    // Start game loop at 60Hz
    this.setSimulationInterval((deltaTime) => this.update(deltaTime), 1000 / TICK_RATE);
    
    // Update visibility every second
    this.clock.setInterval(() => this.updateVisibility(), 1000);
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

    // Add bullet to nearby clients' view
    for (const [sessionId, player] of this.state.players) {
      const dx = bullet.x - player.x;
      const dy = bullet.y - player.y;
      const distSq = dx * dx + dy * dy;
      const viewDistSq = VIEW_DISTANCE * VIEW_DISTANCE;

      if (distSq <= viewDistSq) {
        const client = this.clients.find(c => c.sessionId === sessionId);

        // client may be undefined if player is reconnecting
        if (client && !client.view.has(bullet)) {
          client.view.add(bullet);
        }
      }
    }

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

  private updateVisibility() {
    // Update rectangle positions and rebuild quadtree
    this.quadtree.clear();
    for (const [id, player] of this.state.players) {
      const rect = this.playerRects.get(id);
      if (rect) {
        rect.x = player.x - 1;
        rect.y = player.y - 1;
        this.quadtree.insert(rect);
      }
    }

    // Update each client's view
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (!player || !client.view) continue;

      // Query nearby players using reusable queryRect
      this.queryRect.x = player.x - VIEW_DISTANCE;
      this.queryRect.y = player.y - VIEW_DISTANCE;
      const nearby = this.quadtree.retrieve(this.queryRect);
      const nearbyIds = new Set(nearby.map(r => r.data!.id));

      // Add/remove players from view
      for (const [id, otherPlayer] of this.state.players) {
        if (nearbyIds.has(id)) {
          if (!client.view.has(otherPlayer)) {
            client.view.add(otherPlayer);
          }
        } else {
          if (client.view.has(otherPlayer)) {
            client.view.remove(otherPlayer);
          }
        }
      }
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

    // Create quadtree rectangle for this player (reused each frame)
    const rect = new Rectangle({
      x: x - 1,
      y: y - 1,
      width: 2,
      height: 2,
      data: { id: client.sessionId }
    });
    this.playerRects.set(client.sessionId, rect);

    // Initialize StateView for this client
    client.view = new StateView();
    client.view.add(player); // Player always sees themselves
  }

  onDrop(client: Client<any>, code?: CloseCode): void | Promise<any> {
    console.log("ON DROP", client.sessionId, { code });
    if (code !== CloseCode.CONSENTED) {
      const reconnection = this.allowReconnection(client, "manual");
    }
  }

  onLeave(client: Client, code?: number) {
    console.log("ON LEAVE", client.sessionId, { code });

    // // Remove player from all other clients' StateViews
    // const leavingPlayer = this.state.players.get(client.sessionId);
    // if (leavingPlayer) {
    //   for (const otherClient of this.clients) {
    //     if (otherClient.sessionId !== client.sessionId && otherClient.view) {
    //       otherClient.view.remove(leavingPlayer);
    //     }
    //   }
    // }

    // Remove physics body
    const body = this.playerBodies.get(client.sessionId);
    if (body) {
      this.world.removeRigidBody(body);
      this.playerBodies.delete(client.sessionId);
    }

    // Clean up quadtree rectangle
    this.playerRects.delete(client.sessionId);

    // Remove state
    this.state.players.delete(client.sessionId);
    this.pendingInputs.delete(client.sessionId);
    this.shootCooldowns.delete(client.sessionId);
  }

  onDispose() {
    console.log("BattleRoyaleRoom disposing...");
  }
}

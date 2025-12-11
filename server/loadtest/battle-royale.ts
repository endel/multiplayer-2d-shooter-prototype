import { Client, Room } from "colyseus.js";
import { cli, Options } from "@colyseus/loadtest";

const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

// Simulated input state
interface InputState {
  seq: number;
  keys: {
    w: boolean;
    a: boolean;
    s: boolean;
    d: boolean;
  };
  angle: number;
}

export async function main(options: Options) {
  const client = new Client(options.endpoint);
  const room: Room = await client.joinOrCreate(options.roomName || "battle_royale");

  console.log("Joined battle_royale as", room.sessionId);

  // Track state
  let seq = 0;
  let currentAngle = Math.random() * Math.PI * 2;
  let currentKeys = { w: false, a: false, s: false, d: false };
  let isAlive = true;

  // Change movement direction periodically
  let movementChangeTime = 0;
  const movementChangePeriod = 500 + Math.random() * 2000; // 0.5-2.5 seconds

  // Shooting cooldown
  let lastShootTime = 0;
  const shootCooldown = 200 + Math.random() * 300; // 200-500ms between shots
  const shootChance = 0.3; // 30% chance to shoot each cooldown period

  // Track stats
  let kills = 0;
  let deaths = 0;

  // Handle messages
  room.onMessage("hit", (message) => {
    if (message.targetId === room.sessionId) {
      console.log(`[${room.sessionId}] Got hit! Health: ${message.health}`);
      if (message.health <= 0) {
        isAlive = false;
      }
    }
  });

  room.onMessage("kill", (message) => {
    if (message.killerId === room.sessionId) {
      kills++;
      console.log(`[${room.sessionId}] Got a kill! Total kills: ${kills}`);
    }
    if (message.targetId === room.sessionId) {
      deaths++;
      isAlive = false;
      console.log(`[${room.sessionId}] Died! Total deaths: ${deaths}`);
    }
  });

  room.onStateChange((state) => {
    // Check if we respawned
    const player = state.players?.get(room.sessionId);
    if (player && player.health > 0 && !isAlive) {
      isAlive = true;
      console.log(`[${room.sessionId}] Respawned!`);
    }
  });

  room.onLeave((code) => {
    console.log(`[${room.sessionId}] Left room. Code: ${code}. Kills: ${kills}, Deaths: ${deaths}`);
  });

  // Simulate random movement behavior
  function updateMovement() {
    const now = Date.now();

    // Change direction periodically
    if (now - movementChangeTime > movementChangePeriod) {
      movementChangeTime = now;

      // Random movement pattern
      const pattern = Math.random();
      if (pattern < 0.2) {
        // Stand still
        currentKeys = { w: false, a: false, s: false, d: false };
      } else if (pattern < 0.5) {
        // Move in one direction
        currentKeys = {
          w: Math.random() > 0.5,
          a: Math.random() > 0.5,
          s: Math.random() > 0.5,
          d: Math.random() > 0.5,
        };
      } else {
        // Move forward while strafing
        currentKeys = {
          w: true,
          a: Math.random() > 0.7,
          s: false,
          d: Math.random() > 0.7,
        };
      }

      // Gradually change angle (simulating looking around)
      currentAngle += (Math.random() - 0.5) * Math.PI * 0.5;
    }

    // Small angle adjustments each frame (simulating mouse movement)
    currentAngle += (Math.random() - 0.5) * 0.1;
  }

  // Simulate shooting behavior
  function tryShoot() {
    const now = Date.now();
    if (isAlive && now - lastShootTime > shootCooldown) {
      if (Math.random() < shootChance) {
        room.send("shoot", { angle: currentAngle });
        lastShootTime = now;
      }
    }
  }

  // Main game loop - simulate input at tick rate
  const inputLoop = setInterval(() => {
    if (!isAlive) return;

    updateMovement();
    tryShoot();

    // Send input to server
    seq++;
    const input: InputState = {
      seq,
      keys: currentKeys,
      angle: currentAngle,
    };

    room.send("input", input);
  }, TICK_INTERVAL);

  // Cleanup on room leave
  room.onLeave(() => {
    clearInterval(inputLoop);
  });
}

cli(main);

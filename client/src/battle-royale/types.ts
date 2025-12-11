// Game constants (must match server)
export const MAP_SIZE = 2000;
export const PLAYER_RADIUS = 25;
export const PLAYER_SPEED = 200;
export const BULLET_RADIUS = 5;
export const BULLET_SPEED = 800;
export const TICK_RATE = 60;
export const MAX_HEALTH = 500;

// Colors
export const COLORS = {
  BACKGROUND: 0x2d5a27,      // Dark green grass
  PLAYER_SELF: 0xf1c40f,     // Yellow for local player
  PLAYER_OTHER: 0xe74c3c,    // Red for enemies
  PLAYER_DEAD: 0x7f8c8d,     // Gray for dead players
  BULLET: 0xffffff,          // White bullets
  AIM_LINE: 0xffffff,        // White aim line
  HEALTH_BAR_BG: 0x2c3e50,   // Dark health bar background
  HEALTH_BAR: 0x27ae60,      // Green health bar
  HEALTH_BAR_LOW: 0xe74c3c,  // Red when low health
  MAP_BORDER: 0x1a3d16,      // Darker green border
};

// Input state
export interface InputState {
  seq: number;
  keys: {
    w: boolean;
    a: boolean;
    s: boolean;
    d: boolean;
  };
  angle: number;
  timestamp: number;
}

// Server message types
export interface HitMessage {
  targetId: string;
  shooterId: string;
  damage: number;
  health: number;
}

export interface KillMessage {
  targetId: string;
  killerId: string;
}

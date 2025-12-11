import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { COLORS, MAP_SIZE, PLAYER_RADIUS, BULLET_RADIUS, MAX_HEALTH } from "./types";

export interface PlayerRenderData {
  x: number;
  y: number;
  angle: number;
  health: number;
  isLocal: boolean;
  isDead: boolean;
}

export interface BulletRenderData {
  x: number;
  y: number;
}

export class Renderer {
  private app: Application;
  private worldContainer: Container;
  private playersContainer: Container;
  private bulletsContainer: Container;
  private uiContainer: Container;

  private playerGraphics: Map<string, Graphics> = new Map();
  private bulletGraphics: Map<string, Graphics> = new Map();
  
  private cameraX = 0;
  private cameraY = 0;

  // UI elements
  private healthText: Text | null = null;
  private killFeedTexts: Text[] = [];
  private hitOverlay: Graphics | null = null;

  constructor() {
    this.app = new Application();
    this.worldContainer = new Container();
    this.playersContainer = new Container();
    this.bulletsContainer = new Container();
    this.uiContainer = new Container();
  }

  async init(container: HTMLElement) {
    await this.app.init({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: COLORS.BACKGROUND,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(this.app.canvas);

    // Setup world container hierarchy
    this.app.stage.addChild(this.worldContainer);
    this.worldContainer.addChild(this.bulletsContainer);
    this.worldContainer.addChild(this.playersContainer);
    
    // UI container (doesn't move with camera)
    this.app.stage.addChild(this.uiContainer);

    // Draw map background and border
    this.drawMap();

    // Setup UI
    this.setupUI();

    // Handle window resize
    window.addEventListener("resize", () => this.handleResize());
  }

  private drawMap() {
    const mapGraphics = new Graphics();

    // Draw grass background with grid pattern
    mapGraphics.rect(-MAP_SIZE / 2, -MAP_SIZE / 2, MAP_SIZE, MAP_SIZE);
    mapGraphics.fill(COLORS.BACKGROUND);

    // Draw grid lines for visual reference
    const gridSize = 100;
    mapGraphics.setStrokeStyle({ width: 1, color: 0x3d6a37, alpha: 0.5 });
    
    for (let x = -MAP_SIZE / 2; x <= MAP_SIZE / 2; x += gridSize) {
      mapGraphics.moveTo(x, -MAP_SIZE / 2);
      mapGraphics.lineTo(x, MAP_SIZE / 2);
    }
    for (let y = -MAP_SIZE / 2; y <= MAP_SIZE / 2; y += gridSize) {
      mapGraphics.moveTo(-MAP_SIZE / 2, y);
      mapGraphics.lineTo(MAP_SIZE / 2, y);
    }
    mapGraphics.stroke();

    // Draw border
    mapGraphics.setStrokeStyle({ width: 10, color: COLORS.MAP_BORDER });
    mapGraphics.rect(-MAP_SIZE / 2, -MAP_SIZE / 2, MAP_SIZE, MAP_SIZE);
    mapGraphics.stroke();

    this.worldContainer.addChildAt(mapGraphics, 0);
  }

  private setupUI() {
    const style = new TextStyle({
      fontFamily: "Arial",
      fontSize: 24,
      fontWeight: "bold",
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 4 },
    });

    this.healthText = new Text({ text: "Health: 100", style });
    this.healthText.x = 20;
    this.healthText.y = 20;
    this.uiContainer.addChild(this.healthText);

    // Red flash overlay for hit feedback (added last to sit on top)
    this.hitOverlay = new Graphics();
    this.redrawHitOverlay();
    this.hitOverlay.alpha = 0;
    this.hitOverlay.eventMode = "none";
    this.uiContainer.addChild(this.hitOverlay);
  }

  private handleResize() {
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
    this.redrawHitOverlay();
  }

  setLocalPlayer(_playerId: string) {
    // Could be used for special local player rendering
  }

  updateCamera(targetX: number, targetY: number) {
    // Smooth camera follow
    const smoothing = 0.1;
    this.cameraX += (targetX - this.cameraX) * smoothing;
    this.cameraY += (targetY - this.cameraY) * smoothing;

    // Center camera on target
    this.worldContainer.x = this.app.screen.width / 2 - this.cameraX;
    this.worldContainer.y = this.app.screen.height / 2 - this.cameraY;
  }

  updatePlayers(players: Map<string, PlayerRenderData>) {
    // Update or create player graphics
    for (const [id, data] of players) {
      let graphics = this.playerGraphics.get(id);
      
      if (!graphics) {
        graphics = new Graphics();
        this.playerGraphics.set(id, graphics);
        this.playersContainer.addChild(graphics);
      }

      this.drawPlayer(graphics, data);
    }

    // Remove graphics for players that no longer exist
    for (const [id, graphics] of this.playerGraphics) {
      if (!players.has(id)) {
        this.playersContainer.removeChild(graphics);
        this.playerGraphics.delete(id);
      }
    }
  }

  private drawPlayer(graphics: Graphics, data: PlayerRenderData) {
    graphics.clear();

    const color = data.isDead 
      ? COLORS.PLAYER_DEAD 
      : (data.isLocal ? COLORS.PLAYER_SELF : COLORS.PLAYER_OTHER);

    // Draw player body (circle)
    graphics.circle(0, 0, PLAYER_RADIUS);
    graphics.fill(color);
    graphics.setStrokeStyle({ width: 3, color: 0x000000, alpha: 0.3 });
    graphics.stroke();

    // Draw aim direction line (gun)
    if (!data.isDead) {
      const aimLength = PLAYER_RADIUS + 15;
      graphics.setStrokeStyle({ width: 6, color: 0x333333 });
      graphics.moveTo(0, 0);
      graphics.lineTo(Math.cos(data.angle) * aimLength, Math.sin(data.angle) * aimLength);
      graphics.stroke();
    }

    // Draw health bar above player
    if (!data.isDead) {
      const healthBarWidth = PLAYER_RADIUS * 2;
      const healthBarHeight = 6;
      const healthBarY = -PLAYER_RADIUS - 15;
      
      // Background
      graphics.rect(-healthBarWidth / 2, healthBarY, healthBarWidth, healthBarHeight);
      graphics.fill(COLORS.HEALTH_BAR_BG);

      // Health fill
      const healthPercent = Math.min(1, data.health / MAX_HEALTH);
      const healthColor = healthPercent > 0.3 ? COLORS.HEALTH_BAR : COLORS.HEALTH_BAR_LOW;
      graphics.rect(-healthBarWidth / 2, healthBarY, healthBarWidth * healthPercent, healthBarHeight);
      graphics.fill(healthColor);
    }

    // Position the graphics
    graphics.x = data.x;
    graphics.y = data.y;
  }

  updateBullets(bullets: Map<string, BulletRenderData>) {
    // Update or create bullet graphics
    for (const [id, data] of bullets) {
      let graphics = this.bulletGraphics.get(id);
      
      if (!graphics) {
        graphics = new Graphics();
        graphics.circle(0, 0, BULLET_RADIUS);
        graphics.fill(COLORS.BULLET);
        this.bulletGraphics.set(id, graphics);
        this.bulletsContainer.addChild(graphics);
      }

      graphics.x = data.x;
      graphics.y = data.y;
    }

    // Remove graphics for bullets that no longer exist
    for (const [id, graphics] of this.bulletGraphics) {
      if (!bullets.has(id)) {
        this.bulletsContainer.removeChild(graphics);
        this.bulletGraphics.delete(id);
      }
    }
  }

  updateUI(health: number) {
    if (this.healthText) {
      this.healthText.text = `Health: ${Math.ceil(health)}`;
    }
  }

  /**
   * Brief red flash when the local player is hit
   */
  flashHit(intensity: number = 0.5, durationMs: number = 150) {
    if (!this.hitOverlay) return;

    const startAlpha = intensity;
    this.hitOverlay.alpha = startAlpha;
    const start = performance.now();

    const fade = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      this.hitOverlay!.alpha = startAlpha * (1 - t);
      if (t < 1) {
        requestAnimationFrame(fade);
      } else {
        this.hitOverlay!.alpha = 0;
      }
    };

    requestAnimationFrame(fade);
  }

  private redrawHitOverlay() {
    if (!this.hitOverlay) return;
    this.hitOverlay.clear();
    this.hitOverlay.rect(0, 0, this.app.screen.width, this.app.screen.height);
    this.hitOverlay.fill(0xff0000);
  }

  showKillFeed(message: string) {
    const style = new TextStyle({
      fontFamily: "Arial",
      fontSize: 18,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 3 },
    });

    const text = new Text({ text: message, style });
    text.x = this.app.screen.width - 250;
    text.y = 20 + this.killFeedTexts.length * 25;
    text.alpha = 1;

    this.uiContainer.addChild(text);
    this.killFeedTexts.push(text);

    // Fade out and remove after 3 seconds
    setTimeout(() => {
      const index = this.killFeedTexts.indexOf(text);
      if (index > -1) {
        this.killFeedTexts.splice(index, 1);
        this.uiContainer.removeChild(text);
        
        // Reposition remaining texts
        this.killFeedTexts.forEach((t, i) => {
          t.y = 20 + i * 25;
        });
      }
    }, 3000);
  }

  getCanvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  destroy() {
    this.app.destroy(true);
  }
}

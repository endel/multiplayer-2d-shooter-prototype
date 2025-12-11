import type { InputState } from "./types";

export type InputCallback = (input: InputState) => void;
export type ShootCallback = (angle: number) => void;

export class InputHandler {
  private keys: { w: boolean; a: boolean; s: boolean; d: boolean } = {
    w: false,
    a: false,
    s: false,
    d: false,
  };

  private mouseX = 0;
  private mouseY = 0;
  private mouseDown = false;
  private seq = 0;

  private canvas: HTMLCanvasElement;

  private onInput: InputCallback;
  private onShoot: ShootCallback;

  private inputInterval: number | null = null;
  private shootCooldown = false;
  private readonly shootCooldownMs = 200;

  constructor(
    canvas: HTMLCanvasElement,
    onInput: InputCallback,
    onShoot: ShootCallback
  ) {
    this.canvas = canvas;
    this.onInput = onInput;
    this.onShoot = onShoot;

    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Keyboard events
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);

    // Mouse events
    this.canvas.addEventListener("mousemove", this.handleMouseMove);
    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    this.canvas.addEventListener("mouseup", this.handleMouseUp);

    // Prevent context menu on right click
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === "w" || key === "arrowup") this.keys.w = true;
    if (key === "a" || key === "arrowleft") this.keys.a = true;
    if (key === "s" || key === "arrowdown") this.keys.s = true;
    if (key === "d" || key === "arrowright") this.keys.d = true;
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (key === "w" || key === "arrowup") this.keys.w = false;
    if (key === "a" || key === "arrowleft") this.keys.a = false;
    if (key === "s" || key === "arrowdown") this.keys.s = false;
    if (key === "d" || key === "arrowright") this.keys.d = false;
  };

  private handleMouseMove = (e: MouseEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) { // Left click
      this.mouseDown = true;
      this.tryShoot();
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.mouseDown = false;
    }
  };

  private tryShoot() {
    if (this.shootCooldown) return;
    
    const angle = this.getAimAngle();
    this.onShoot(angle);
    
    this.shootCooldown = true;
    setTimeout(() => {
      this.shootCooldown = false;
      // Auto-fire if mouse still held
      if (this.mouseDown) {
        this.tryShoot();
      }
    }, this.shootCooldownMs);
  }

  /**
   * Update camera position for accurate aim calculation
   * (Currently not needed as we use screen-center-relative aiming)
   */
  updateCamera(_x: number, _y: number) {
    // Camera position not needed for current aim calculation
  }

  /**
   * Calculate aim angle from player to mouse cursor in world space
   */
  getAimAngle(): number {
    // Use CSS dimensions (clientWidth/clientHeight) instead of internal canvas resolution
    // This matches the coordinate system used by getBoundingClientRect() in handleMouseMove
    const screenCenterX = this.canvas.clientWidth / 2;
    const screenCenterY = this.canvas.clientHeight / 2;
    
    // Mouse offset from screen center
    const mouseOffsetX = this.mouseX - screenCenterX;
    const mouseOffsetY = this.mouseY - screenCenterY;

    // Calculate angle (player is at camera position, which is screen center)
    return Math.atan2(mouseOffsetY, mouseOffsetX);
  }

  /**
   * Get current input state and increment sequence number
   */
  getCurrentInput(): InputState {
    return {
      seq: ++this.seq,
      keys: { ...this.keys },
      angle: this.getAimAngle(),
      timestamp: Date.now(),
    };
  }

  /**
   * Check if any movement keys are pressed
   */
  isMoving(): boolean {
    return this.keys.w || this.keys.a || this.keys.s || this.keys.d;
  }

  /**
   * Start sending inputs at fixed rate
   */
  startInputLoop(tickRate: number = 60) {
    if (this.inputInterval) {
      clearInterval(this.inputInterval);
    }

    this.inputInterval = window.setInterval(() => {
      const input = this.getCurrentInput();
      this.onInput(input);
    }, 1000 / tickRate);
  }

  /**
   * Stop the input loop
   */
  stopInputLoop() {
    if (this.inputInterval) {
      clearInterval(this.inputInterval);
      this.inputInterval = null;
    }
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    this.stopInputLoop();
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.canvas.removeEventListener("mousemove", this.handleMouseMove);
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.canvas.removeEventListener("mouseup", this.handleMouseUp);
  }
}

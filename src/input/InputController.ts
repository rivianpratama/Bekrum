import type { InputIntent } from "../shared/types";

const MOVEMENT_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "KeyE"]);

export class InputController {
  private pressed = new Set<string>();
  private sequence = 0;
  yaw = 0;
  pitch = 0;

  constructor(private readonly element: HTMLElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
  }

  lock(): void {
    void this.element.requestPointerLock();
  }

  sample(dt: number): InputIntent {
    const forward = Number(this.pressed.has("KeyW")) - Number(this.pressed.has("KeyS"));
    const strafe = Number(this.pressed.has("KeyD")) - Number(this.pressed.has("KeyA"));
    return {
      sequence: this.sequence++,
      forward,
      strafe,
      yaw: this.yaw,
      sprint: this.pressed.has("ShiftLeft") || this.pressed.has("ShiftRight"),
      stomp: this.pressed.has("KeyE"),
      dt: Math.min(dt, 0.1),
    };
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (MOVEMENT_KEYS.has(event.code)) {
      event.preventDefault();
      this.pressed.add(event.code);
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.element) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - event.movementY * 0.002));
  };
}

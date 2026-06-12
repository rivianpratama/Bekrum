import type { Vec2 } from "../shared/types";

export class Atmosphere {
  private context: AudioContext | null = null;
  private humGain: GainNode | null = null;
  private footstepBuffer: AudioBuffer | null = null;
  private lastPosition: Vec2 | null = null;
  private distanceSinceStep = 0;
  private lastMovementTime = 0;
  private lastStepTime = 0;
  private stepSide = 0;

  start(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.value = 0.025;
    gain.connect(context.destination);
    const hum = context.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 60;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 180;
    hum.connect(filter).connect(gain);
    hum.start();
    this.context = context;
    this.humGain = gain;
    this.footstepBuffer = this.createFootstepBuffer(context);
    this.lastMovementTime = context.currentTime;
  }

  setAggro(active: boolean): void {
    if (!this.context || !this.humGain) return;
    this.humGain.gain.setTargetAtTime(active ? 0.06 : 0.025, this.context.currentTime, 0.2);
  }

  updateFootsteps(position: Vec2 | null, active: boolean): void {
    if (!position) {
      this.lastPosition = null;
      this.distanceSinceStep = 0;
      return;
    }
    if (!this.lastPosition) {
      this.lastPosition = { ...position };
      return;
    }

    const distance = Math.hypot(
      position.x - this.lastPosition.x,
      position.z - this.lastPosition.z,
    );
    this.lastPosition = { ...position };
    if (!active || distance > 3) {
      this.distanceSinceStep = 0;
      return;
    }

    const context = this.context;
    if (!context || context.state !== "running" || distance < 0.002) return;
    const elapsed = Math.max(0.01, context.currentTime - this.lastMovementTime);
    this.lastMovementTime = context.currentTime;
    const speed = distance / elapsed;
    const running = speed > 6.2;
    const stepDistance = running ? 1.55 : 1.7;
    const minimumInterval = running ? 0.22 : 0.3;
    this.distanceSinceStep += distance;
    if (
      this.distanceSinceStep >= stepDistance &&
      context.currentTime - this.lastStepTime >= minimumInterval
    ) {
      this.distanceSinceStep %= stepDistance;
      this.lastStepTime = context.currentTime;
      this.playFootstep(running);
    }
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
    this.humGain = null;
    this.footstepBuffer = null;
    this.lastPosition = null;
  }

  private createFootstepBuffer(context: AudioContext): AudioBuffer {
    const duration = 0.11;
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * duration), context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      const decay = 1 - index / channel.length;
      channel[index] = (Math.random() * 2 - 1) * decay * decay;
    }
    return buffer;
  }

  private playFootstep(running: boolean): void {
    const context = this.context;
    const buffer = this.footstepBuffer;
    if (!context || !buffer) return;
    const now = context.currentTime;
    const sideVariation = this.stepSide++ % 2 === 0 ? -35 : 35;

    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();
    noise.buffer = buffer;
    noise.playbackRate.value = running ? 1.12 : 0.92;
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 650 + sideVariation;
    noiseFilter.Q.value = 0.7;
    noiseGain.gain.setValueAtTime(running ? 0.12 : 0.09, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    noise.connect(noiseFilter).connect(noiseGain).connect(context.destination);
    noise.start(now);
    noise.stop(now + 0.12);

    const thump = context.createOscillator();
    const thumpGain = context.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(running ? 105 : 88, now);
    thump.frequency.exponentialRampToValueAtTime(58, now + 0.08);
    thumpGain.gain.setValueAtTime(running ? 0.045 : 0.032, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    thump.connect(thumpGain).connect(context.destination);
    thump.start(now);
    thump.stop(now + 0.1);
  }
}

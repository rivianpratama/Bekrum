export class Atmosphere {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;

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
    this.gain = gain;
  }

  setAggro(active: boolean): void {
    if (!this.context || !this.gain) return;
    this.gain.gain.setTargetAtTime(active ? 0.06 : 0.025, this.context.currentTime, 0.2);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }
}

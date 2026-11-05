export const sounds = {
  break: 95,
  place: 145,
  step: 65,
  pickup: 660,
  hurt: 180,
  jump: 240,
  land: 75,
  craft: 440,
  eat: 150,
  cow: 85,
  pig: 180,
  sheep: 250,
  chicken: 450,
  hollow: 70,
  bonewalker: 135,
  burster: 90,
  crawler: 210,
  water: 220,
  rain: 700,
  thunder: 55,
  door: 110,
  chest: 160,
  furnace: 100,
  bow: 380,
} as const;
export type SoundKind = keyof typeof sounds;
export class GameAudio {
  volume = 0.35;
  effects = 0.8;
  music = 0.12;
  private context?: AudioContext;
  private last = new Map<string, number>();
  private musicClock = 0;
  private note = 0;
  private noise?: AudioBuffer;
  unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
  }
  play(kind: SoundKind) {
    const ctx = this.context;
    if (!ctx || this.volume * this.effects <= 0) return;
    const now = ctx.currentTime,
      min =
        kind === "step"
          ? 0.32
          : ["rain", "water", "furnace"].includes(kind)
            ? 1.5
            : [
                  "cow",
                  "pig",
                  "sheep",
                  "chicken",
                  "hollow",
                  "bonewalker",
                  "crawler",
                  "burster",
                ].includes(kind)
              ? 4
              : 0.03;
    if (now - (this.last.get(kind) ?? -100) < min) return;
    this.last.set(kind, now);
    const gain = ctx.createGain(),
      duration = kind === "thunder" ? 1.6 : kind === "rain" ? 0.8 : 0.15;
    gain.gain.setValueAtTime(
      this.volume * this.effects * (kind === "step" ? 0.035 : 0.09),
      now,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    gain.connect(ctx.destination);
    if (["rain", "thunder", "water", "furnace"].includes(kind)) {
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let seed = 1977;
        for (let i = 0; i < data.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          data[i] = seed / 2147483648 - 1;
        }
      }
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter();
      source.buffer = this.noise;
      filter.type = "lowpass";
      filter.frequency.value =
        kind === "thunder" ? 180 : kind === "rain" ? 1100 : 450;
      source.connect(filter);
      filter.connect(gain);
      source.start();
      source.stop(now + duration);
    } else {
      const osc = ctx.createOscillator();
      osc.type = ["pickup", "craft", "chicken"].includes(kind)
        ? "sine"
        : "triangle";
      osc.frequency.setValueAtTime(sounds[kind], now);
      osc.frequency.exponentialRampToValueAtTime(
        sounds[kind] * 0.55,
        now + duration,
      );
      osc.connect(gain);
      osc.start();
      osc.stop(now + duration);
    }
  }
  tick(dt: number, active: boolean) {
    if (!active || !this.context || this.music <= 0 || this.volume <= 0) return;
    this.musicClock += dt;
    if (this.musicClock < 3) return;
    this.musicClock = 0;
    const ctx = this.context,
      now = ctx.currentTime,
      osc = ctx.createOscillator(),
      gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = [
      196, 246.94, 293.66, 329.63, 293.66, 246.94, 220, 196,
    ][this.note++ % 8];
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      this.volume * this.music * 0.035,
      now + 0.4,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(now + 2.6);
  }
}

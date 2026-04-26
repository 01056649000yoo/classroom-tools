const STORAGE_KEY = 'classroom:sfx';

type Settings = { volume: number; muted: boolean };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { volume: 0.5, muted: false };
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : 0.5,
      muted: !!p.muted,
    };
  } catch {
    return { volume: 0.5, muted: false };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: Settings = loadSettings();
  private listeners = new Set<(s: Settings) => void>();

  private ensureContext() {
    if (this.ctx) return;
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.effectiveVolume();
    this.master.connect(this.ctx.destination);
  }

  private effectiveVolume() {
    return this.settings.muted ? 0 : this.settings.volume;
  }

  private applyVolume() {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.effectiveVolume(),
        this.ctx.currentTime,
        0.01,
      );
    }
  }

  getSettings(): Settings {
    return { ...this.settings };
  }

  subscribe(fn: (s: Settings) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify() {
    const snap = this.getSettings();
    this.listeners.forEach((l) => l(snap));
  }

  setVolume(v: number) {
    this.settings.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
    saveSettings(this.settings);
    this.notify();
  }

  setMuted(m: boolean) {
    this.settings.muted = m;
    this.applyVolume();
    saveSettings(this.settings);
    this.notify();
  }

  resume() {
    this.ensureContext();
    if (this.ctx?.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  tick() {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    if (this.effectiveVolume() === 0) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1000 + Math.random() * 500;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  ding() {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    if (this.effectiveVolume() === 0) return;
    const now = this.ctx.currentTime;
    [880, 1318.5, 1760].forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const peak = i === 0 ? 0.28 : i === 1 ? 0.18 : 0.1;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(now);
      osc.stop(now + 0.75);
    });
  }

  whoosh(durationMs: number) {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    if (this.effectiveVolume() === 0) return;
    const now = this.ctx.currentTime;
    const duration = Math.max(0.15, durationMs / 1000);
    const sampleCount = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.5;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3.5;
    filter.frequency.setValueAtTime(350, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.28, now + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  pop() {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    if (this.effectiveVolume() === 0) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  fanfare() {
    this.ensureContext();
    if (!this.ctx || !this.master) return;
    if (this.effectiveVolume() === 0) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const start = now + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.24, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55);
      osc.connect(gain);
      gain.connect(this.master!);
      osc.start(start);
      osc.stop(start + 0.6);
    });
  }
}

export const sfx = new Sfx();

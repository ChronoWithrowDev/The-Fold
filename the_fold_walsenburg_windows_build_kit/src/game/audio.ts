import type { Settings } from './types';

export type SoundName = 'fireA' | 'fireB' | 'open' | 'traverse' | 'switch' | 'door' | 'pickup' | 'impact' | 'error' | 'complete' | 'step';

export class FoldAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private effects: GainNode | null = null;
  private music: GainNode | null = null;
  private settings: Settings;
  private ambienceStarted = false;

  constructor(settings: Settings) { this.settings = settings; }

  start() {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.effects = this.context.createGain();
        this.effects.connect(this.master);
        this.music = this.context.createGain();
        this.music.connect(this.master);
        this.configure(this.settings);
      }
      void this.context.resume().catch(() => undefined);
      if (!this.ambienceStarted) this.ambience();
    } catch { /* Audio is optional when a host blocks the Web Audio API. */ }
  }

  configure(settings: Settings) {
    this.settings = settings;
    if (!this.context || !this.master || !this.effects || !this.music) return;
    const t = this.context.currentTime;
    this.master.gain.setTargetAtTime(settings.muted ? 0 : settings.master / 100, t, 0.08);
    this.effects.gain.setTargetAtTime(settings.effects / 100, t, 0.08);
    this.music.gain.setTargetAtTime(settings.music / 100, t, 0.2);
    if (settings.muted && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  private ambience() {
    const ctx = this.context;
    if (!ctx || !this.music || !this.effects) return;
    this.ambienceStarted = true;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.018) / 1.02;
      data[i] = last * 2.5;
    }
    const wind = ctx.createBufferSource();
    wind.buffer = buffer;
    wind.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 480;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.2;
    wind.connect(filter).connect(windGain).connect(this.effects);
    wind.start();
    [98, 146.83, 220, 293.66].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      gain.gain.value = 0.014;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.027 + i * 0.009;
      const depth = ctx.createGain();
      depth.gain.value = 0.009;
      lfo.connect(depth).connect(gain.gain);
      osc.connect(gain).connect(this.music!);
      osc.start();
      lfo.start();
    });
  }

  play(name: SoundName, pan = 0) {
    const ctx = this.context;
    if (!ctx || !this.effects || ctx.state !== 'running') return;
    const presets: Record<SoundName, [number, number, number, OscillatorType, number]> = {
      fireA: [740, 150, 0.22, 'sine', 0.15],
      fireB: [480, 105, 0.25, 'triangle', 0.13],
      open: [120, 660, 0.38, 'sine', 0.12],
      traverse: [80, 900, 0.45, 'sine', 0.15],
      switch: [330, 660, 0.2, 'triangle', 0.12],
      door: [90, 45, 0.65, 'sawtooth', 0.035],
      pickup: [280, 420, 0.14, 'sine', 0.12],
      impact: [110, 35, 0.12, 'triangle', 0.12],
      error: [155, 125, 0.16, 'square', 0.045],
      complete: [392, 784, 0.85, 'sine', 0.12],
      step: [62, 35, 0.055, 'triangle', 0.04],
    };
    const [from, to, duration, type, volume] = presets[name];
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(panner).connect(this.effects);
    osc.start(t);
    osc.stop(t + duration + 0.02);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); panner.disconnect(); };
  }

  speak(text: string) {
    if (!this.settings.narration || this.settings.muted || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.96;
    utterance.pitch = 0.92;
    utterance.volume = this.settings.master / 100;
    const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en') && /female|samantha|zira|aria/i.test(v.name));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  suspend() { if (this.context) void this.context.suspend(); }
  dispose() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (this.context) void this.context.close();
    this.context = null;
  }
}
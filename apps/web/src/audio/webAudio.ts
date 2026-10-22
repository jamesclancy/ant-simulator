import type { AudioBackend, AudioVolumes, LoopId, PlayOptions, SfxId, TrackId } from './types';
import { SAMPLE_RATE, midiHz, renderAll } from './synth';
import { SCORES, type NoteEvent, type TrackScore } from './score';

const MAX_VOICES = 24;
const CROSSFADE = 1.5;
const LOOKAHEAD = 0.25;
const TICK_MS = 80;
/** Perceptual volume curve: slider position -> gain. */
const curve = (v: number): number => v * v;

type AudioContextCtor = typeof AudioContext;

function noiseBuffer(ctx: BaseAudioContext, seconds: number, crackle: boolean): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    // Crackle: sparse clicks, like many tiny feet; otherwise plain white noise.
    data[i] = crackle ? (Math.random() < 0.004 ? Math.random() * 2 - 1 : 0) : Math.random() * 2 - 1;
  }
  return buf;
}

/** Web Audio implementation: SFX + music buses, loops, procedural chiptune sequencer. */
export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private buffers = new Map<SfxId, AudioBuffer>();
  private loops = new Map<LoopId, GainNode>();
  private voices = 0;
  private volumes: AudioVolumes = { sfx: 0.8, music: 0.5, muted: false };
  private suspended = false;
  private wantTrack: TrackId | null = null;
  private wantIntensity = 0;
  private wantLoops: Record<LoopId, number> = { rain: 0, skitter: 0, mower: 0 };
  private music: TrackPlayer | null = null;
  private pulse = new Map<number, PeriodicWave>();
  private noise!: AudioBuffer;

  /** Create the context and render the sound bank. Call from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor: AudioContextCtor | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    this.syncRunning();
  }

  /** Test/debug probe (exposed through `window.__antDebug`). */
  debugState(): {
    context: string;
    voices: number;
    track: TrackId | null;
    sfxGain: number;
    musicGain: number;
    masterGain: number;
  } {
    return {
      context: this.ctx?.state ?? 'none',
      voices: this.voices,
      track: this.music?.id ?? null,
      sfxGain: this.ctx ? this.sfxBus.gain.value : 0,
      musicGain: this.ctx ? this.musicBus.gain.value : 0,
      masterGain: this.ctx ? this.master.gain.value : 0,
    };
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  private build(ctx: AudioContext): void {
    const compressor = ctx.createDynamicsCompressor();
    compressor.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(compressor);
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    for (const [id, pcm] of Object.entries(renderAll())) {
      const buf = ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
      buf.getChannelData(0).set(pcm);
      this.buffers.set(id as SfxId, buf);
    }
    this.noise = noiseBuffer(ctx, 1, false);
    this.buildLoops(ctx);
    this.applyVolumes();
    // iOS: a silent buffer played inside the gesture fully unlocks output.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silent.connect(ctx.destination);
    silent.start(0);
    this.applyMusic();
    for (const id of ['rain', 'skitter', 'mower'] as const) this.setLoop(id, this.wantLoops[id]);
  }

  private buildLoops(ctx: AudioContext): void {
    const rain = ctx.createBufferSource();
    rain.buffer = noiseBuffer(ctx, 2, false);
    rain.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    rain.connect(hp).connect(lp).connect(rainGain).connect(this.sfxBus);
    rain.start();
    this.loops.set('rain', rainGain);

    const skitter = ctx.createBufferSource();
    skitter.buffer = noiseBuffer(ctx, 1.7, true);
    skitter.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.8;
    const skitterGain = ctx.createGain();
    skitterGain.gain.value = 0;
    skitter.connect(bp).connect(skitterGain).connect(this.sfxBus);
    skitter.start();
    this.loops.set('skitter', skitterGain);

    // Mower engine: a rough sawtooth drone with a wobbling pitch, over a bed of noise.
    const engine = ctx.createOscillator();
    engine.type = 'sawtooth';
    engine.frequency.value = 62;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 9;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 5;
    wobble.connect(wobbleDepth).connect(engine.frequency);
    const engineLp = ctx.createBiquadFilter();
    engineLp.type = 'lowpass';
    engineLp.frequency.value = 650;
    const mowerGain = ctx.createGain();
    mowerGain.gain.value = 0;
    engine.connect(engineLp).connect(mowerGain);
    const whirr = ctx.createBufferSource();
    whirr.buffer = noiseBuffer(ctx, 1.3, false);
    whirr.loop = true;
    const whirrBp = ctx.createBiquadFilter();
    whirrBp.type = 'bandpass';
    whirrBp.frequency.value = 1500;
    const whirrGain = ctx.createGain();
    whirrGain.gain.value = 0.22;
    whirr.connect(whirrBp).connect(whirrGain).connect(mowerGain);
    mowerGain.connect(this.sfxBus);
    engine.start();
    wobble.start();
    whirr.start();
    this.loops.set('mower', mowerGain);
  }

  private get running(): boolean {
    return this.ctx !== null && !this.suspended;
  }

  /** Suspend/resume the context to match the background state. */
  private syncRunning(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.suspended) {
      if (ctx.state === 'running') void ctx.suspend().catch(() => {});
    } else if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {});
    }
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    this.syncRunning();
  }

  setVolumes(volumes: AudioVolumes): void {
    this.volumes = volumes;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const ramp = (node: GainNode, value: number): void => {
      node.gain.cancelScheduledValues(t);
      node.gain.setTargetAtTime(value, t, 0.03);
    };
    ramp(this.master, this.volumes.muted ? 0 : 1);
    ramp(this.sfxBus, curve(this.volumes.sfx));
    ramp(this.musicBus, curve(this.volumes.music) * 0.5);
  }

  play(id: SfxId, options: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || this.volumes.muted || this.voices >= MAX_VOICES) return;
    const buffer = this.buffers.get(id);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    if (options.rate) src.playbackRate.value = options.rate;
    const gain = ctx.createGain();
    gain.gain.value = options.gain ?? 1;
    let tail: AudioNode = gain;
    src.connect(gain);
    if (options.pan && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, options.pan));
      gain.connect(pan);
      tail = pan;
    }
    tail.connect(this.sfxBus);
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
      tail.disconnect();
    };
    src.start();
  }

  setLoop(id: LoopId, level: number): void {
    this.wantLoops[id] = level;
    const node = this.loops.get(id);
    const ctx = this.ctx;
    if (!node || !ctx) return;
    const peak = id === 'rain' ? 0.55 : id === 'mower' ? 0.5 : 0.35;
    node.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * peak, ctx.currentTime, 0.25);
  }

  setMusic(track: TrackId | null, intensity: number): void {
    this.wantTrack = track;
    this.wantIntensity = intensity;
    this.applyMusic();
  }

  private applyMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.music && this.music.id !== this.wantTrack) {
      this.music.fadeOut(CROSSFADE);
      this.music = null;
    }
    if (this.wantTrack && !this.music) {
      this.music = new TrackPlayer(this, ctx, this.musicBus, this.wantTrack);
    }
    this.music?.setIntensity(this.wantIntensity);
  }

  /** @internal helpers for TrackPlayer */
  pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
    const key = Math.round(duty * 100);
    let wave = this.pulse.get(key);
    if (!wave) {
      const cos = new Float32Array(33);
      const sin = new Float32Array(33);
      // Cosine series of a pulse wave; phase is irrelevant to the ear.
      for (let n = 1; n < 33; n++) cos[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
      wave = ctx.createPeriodicWave(cos, sin);
      this.pulse.set(key, wave);
    }
    return wave;
  }
  get noiseBuf(): AudioBuffer {
    return this.noise;
  }
}

/** Looks ahead and schedules one track's notes on the audio clock; fades with its own gain. */
class TrackPlayer {
  private gain: GainNode;
  private layer: GainNode;
  private score: TrackScore;
  private timer: number;
  private step = 0;
  private nextTime: number;
  private stopped = false;

  constructor(
    private owner: WebAudioBackend,
    private ctx: AudioContext,
    bus: AudioNode,
    readonly id: TrackId,
  ) {
    this.score = SCORES[id];
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.gain.linearRampToValueAtTime(1, ctx.currentTime + CROSSFADE);
    this.gain.connect(bus);
    this.layer = ctx.createGain();
    this.layer.gain.value = 0;
    this.layer.connect(this.gain);
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
  }

  setIntensity(v: number): void {
    this.layer.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.4);
  }

  fadeOut(seconds: number): void {
    const t = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setValueAtTime(this.gain.gain.value, t);
    this.gain.gain.linearRampToValueAtTime(0, t + seconds);
    this.stopped = true;
    clearInterval(this.timer);
    window.setTimeout(() => this.gain.disconnect(), seconds * 1000 + 300);
  }

  private schedule(): void {
    if (this.stopped) return;
    const { ctx, score } = this;
    // A suspended context's clock is frozen, so nothing piles up while hidden.
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.step = (this.step + 1) % score.steps;
      this.nextTime += score.stepSeconds;
    }
  }

  private playStep(step: number, t: number): void {
    const s = this.score;
    const sec = s.stepSeconds;
    for (const n of s.lead) if (n.step === step) this.tone(n, t, sec, s.leadWave, this.gain, 0.5);
    for (const n of s.bass) if (n.step === step) this.tone(n, t, sec, s.bassWave, this.gain, 0.7);
    for (const n of s.arp) if (n.step === step) this.tone(n, t, sec, 'pulse12', this.layer, 0.3);
    const calm = s.calm[step];
    if (calm) this.drum(calm, t, this.gain, 0.5);
    const drive = s.drive[step];
    if (drive && drive !== calm) this.drum(drive, t, this.layer, 0.8);
  }

  private tone(
    n: NoteEvent,
    t: number,
    stepSeconds: number,
    wave: 'pulse25' | 'pulse50' | 'pulse12' | 'triangle' | 'square',
    dest: AudioNode,
    level: number,
  ): void {
    const { ctx } = this;
    const osc = ctx.createOscillator();
    if (wave === 'triangle' || wave === 'square') osc.type = wave;
    else
      osc.setPeriodicWave(
        this.owner.pulseWave(ctx, wave === 'pulse12' ? 0.125 : wave === 'pulse25' ? 0.25 : 0.5),
      );
    osc.frequency.value = midiHz(n.midi);
    const env = ctx.createGain();
    const len = n.len * stepSeconds;
    const peak = level * 0.22;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.008);
    env.gain.setValueAtTime(peak * 0.8, t + len * 0.7);
    env.gain.linearRampToValueAtTime(0, t + len * 0.95);
    osc.connect(env).connect(dest);
    osc.start(t);
    osc.stop(t + len);
  }

  private drum(kind: string, t: number, dest: AudioNode, level: number): void {
    const { ctx } = this;
    const env = ctx.createGain();
    env.connect(dest);
    if (kind === 'k') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      env.gain.setValueAtTime(0.5 * level, t);
      env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      osc.connect(env);
      osc.start(t);
      osc.stop(t + 0.16);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.owner.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = kind === 's' ? 1500 : 7000;
    const dur = kind === 's' ? 0.12 : 0.04;
    env.gain.setValueAtTime((kind === 's' ? 0.35 : 0.14) * level, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(env);
    src.start(t);
    src.stop(t + dur + 0.02);
  }
}

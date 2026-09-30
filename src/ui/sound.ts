// 효과음. 음원 파일 없이 WebAudio로 합성한다.
// 브라우저 정책상 첫 사용자 입력 전에는 소리를 낼 수 없으므로 AudioContext는 처음 쓸 때 만든다.

export type Sfx = 'coin' | 'button' | 'drop' | 'clunk' | 'win' | 'fail' | 'release';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private motor: { osc: OscillatorNode; gain: GainNode } | null = null;
  muted = false;

  constructor(muted = false) {
    this.muted = muted;
  }

  private ac(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) this.motorOn(false);
    if (this.master) this.master.gain.value = m ? 0 : 0.35;
  }

  /** 짧은 음 하나: 주파수를 f0 → f1로 미끄러뜨리며 감쇠 */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0) {
    const ctx = this.ac();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 짧은 잡음 (철컥 소리) */
  private noise(dur: number, vol: number, freq: number, at = 0) {
    const ctx = this.ac();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + at;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  play(s: Sfx) {
    switch (s) {
      case 'coin':
        this.tone('square', 1320, 1320, 0.08, 0.12);
        this.tone('square', 1760, 1760, 0.25, 0.1, 0.08);
        break;
      case 'button':
        this.tone('triangle', 660, 660, 0.05, 0.1);
        break;
      case 'drop':
        this.tone('sine', 520, 260, 0.35, 0.08);
        break;
      case 'clunk':
        this.noise(0.12, 0.9, 900);
        this.tone('square', 140, 90, 0.08, 0.08);
        break;
      case 'release':
        this.noise(0.08, 0.6, 1400);
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.14, 0.09, i * 0.11));
        break;
      case 'fail':
        this.tone('triangle', 392, 370, 0.22, 0.1);
        this.tone('triangle', 330, 262, 0.4, 0.1, 0.22);
        break;
    }
  }

  /** 갠트리/윈치 모터 소리. speed 0~1 */
  motorOn(on: boolean, speed = 1) {
    if (!on || this.muted) {
      if (this.motor && this.ctx) {
        const { osc, gain } = this.motor;
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        osc.stop(this.ctx.currentTime + 0.2);
        this.motor = null;
      }
      return;
    }
    const ctx = this.ac();
    if (!ctx || !this.master) return;
    if (!this.motor) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(f).connect(gain).connect(this.master);
      osc.start();
      this.motor = { osc, gain };
    }
    this.motor.osc.frequency.setTargetAtTime(70 + 50 * speed, ctx.currentTime, 0.05);
    this.motor.gain.gain.setTargetAtTime(0.05 * Math.min(1, speed), ctx.currentTime, 0.05);
  }
}

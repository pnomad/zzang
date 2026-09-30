import { PHASE_LABEL, type AttemptResult, type Phase } from '../game/analysis';
import type { ControlMode } from '../machine/settings';

export interface Stats { attempts: number; wins: number; spent: number; }

const won = (n: number) => '₩' + n.toLocaleString('ko-KR');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export type HoldKey = 'right' | 'up' | 'left' | 'down' | 'drop';

export interface HudHandlers {
  coin(): void;
  hold(key: HoldKey, down: boolean): void;
  camera(): void;
  replay(): void;
  replayClose(): void;
  replaySeek(frame: number): void;
  replayToggle(): void;
  replaySpeed(s: number): void;
}

export class Hud {
  private phaseEl: HTMLElement;
  private timerEl: HTMLElement;
  private strongEl: HTMLElement;
  private badge: HTMLElement;
  private machineName: HTMLElement;
  private statEls: Record<string, HTMLElement> = {};
  private meter: HTMLElement;
  private meterFill: HTMLElement;
  private meterVal: HTMLElement;
  private swingVal: HTMLElement;
  private controls: HTMLElement;
  private coinBtn!: HTMLButtonElement;
  private camBtn!: HTMLButtonElement;
  private resultEl: HTMLElement;
  private replayEl: HTMLElement;
  private replayRange: HTMLInputElement;
  private replayPhase: HTMLElement;
  private replayPlay: HTMLButtonElement;
  private speedBtns: HTMLButtonElement[] = [];
  private controlMode: ControlMode | null = null;

  constructor(root: HTMLElement, private h: HudHandlers) {
    // 상단 좌측: 모드 + 통계
    const top = el('div', 'hud');
    top.id = 'topbar';
    const card = el('div', 'card');
    const modeRow = el('div', 'mode-row');
    this.badge = el('span', 'badge', '연습');
    this.machineName = el('span', 'machine-name');
    modeRow.append(this.badge, this.machineName);
    const stats = el('div', 'stats');
    for (const [key, label] of [['attempts', '시도'], ['wins', '성공'], ['rate', '성공률'], ['spent', '가상 지출']]) {
      const s = el('div', 'stat' + (key === 'spent' ? ' spent' : ''));
      s.append(el('div', 'k', label));
      const v = el('div', 'v', '0');
      s.append(v);
      this.statEls[key] = v;
      stats.append(s);
    }
    card.append(modeRow, stats);
    top.append(card);

    // 상단 중앙: 진행 상태
    const status = el('div', 'hud');
    status.id = 'status';
    const sc = el('div', 'card');
    this.phaseEl = el('div', '', '');
    this.phaseEl.id = 'phase';
    this.timerEl = el('div', '', '');
    this.timerEl.id = 'timer';
    this.strongEl = el('div', '', '⚡ 강집게 차례');
    this.strongEl.id = 'strong';
    sc.append(this.phaseEl, this.timerEl, this.strongEl);
    status.append(sc);

    // 집게 힘 게이지
    this.meter = el('div', 'hud card');
    this.meter.id = 'meter';
    this.meter.append(el('div', 'label', '집게 힘 (발 하나)'));
    const bar = el('div', 'bar');
    this.meterFill = el('div', 'fill');
    bar.append(this.meterFill);
    this.meterVal = el('div', 'val', '0%');
    this.meter.append(bar, this.meterVal, el('div', 'label', '줄 흔들림'));
    this.swingVal = el('div', 'val', '0°');
    this.meter.append(this.swingVal);

    // 조작 버튼
    this.controls = el('div', 'hud');
    this.controls.id = 'controls';

    // 도움말
    const help = el('div', 'hud card',
      '<b>Enter</b> 동전 · <b>→ ↑</b> 버튼(누르고 있다 떼기)<br><b>V</b> 시점 전환 · <b>R</b> 리플레이');
    help.id = 'help';
    this.help = help;

    // 결과
    this.resultEl = el('div', 'hud');
    this.resultEl.id = 'result';

    // 리플레이 바
    this.replayEl = el('div', 'hud card');
    this.replayEl.id = 'replay';
    this.replayPlay = el('button', 'btn ghost', '⏸');
    this.replayPlay.onclick = () => h.replayToggle();
    this.replayRange = el('input');
    this.replayRange.type = 'range';
    this.replayRange.min = '0';
    this.replayRange.oninput = () => h.replaySeek(Number(this.replayRange.value));
    this.replayPhase = el('span', 'phase');
    const speed = el('div', 'speed');
    for (const s of [0.25, 0.5, 1]) {
      const b = el('button', 'btn ghost' + (s === 0.5 ? ' on' : ''), `×${s}`);
      b.onclick = () => { h.replaySpeed(s); this.speedBtns.forEach((x) => x.classList.toggle('on', x === b)); };
      this.speedBtns.push(b);
      speed.append(b);
    }
    const close = el('button', 'btn ghost', '닫기');
    close.onclick = () => h.replayClose();
    this.replayEl.append(this.replayPlay, this.replayRange, this.replayPhase, speed, close);

    root.append(top, status, this.meter, this.controls, help, this.resultEl, this.replayEl);
  }

  private help: HTMLElement;

  setControlMode(mode: ControlMode, price: number) {
    if (this.controlMode === mode) { this.setPrice(price); return; }
    this.controlMode = mode;
    this.controls.innerHTML = '';
    this.coinBtn = el('button', 'btn coin');
    this.coinBtn.onclick = () => this.h.coin();
    this.setPrice(price);

    const holdBtn = (label: string, key: HoldKey, cls: string) => {
      const b = el('button', 'btn ' + cls, label);
      const down = (e: Event) => { e.preventDefault(); b.classList.add('down'); this.h.hold(key, true); };
      const up = () => { b.classList.remove('down'); this.h.hold(key, false); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      return b;
    };

    this.controls.append(this.coinBtn);
    if (mode === 'twoButton') {
      this.controls.append(holdBtn('→', 'right', 'arrow'), holdBtn('↑', 'up', 'arrow blue'));
      this.help.innerHTML = '<b>Enter</b> 동전 · <b>→</b> 누르고 있다 떼기 → <b>↑</b> 누르고 있다 떼기<br><b>V</b> 시점 전환 · <b>R</b> 리플레이';
    } else {
      const pad = el('div', 'dpad');
      pad.append(el('span'), holdBtn('↑', 'up', 'arrow blue'), el('span'),
        holdBtn('←', 'left', 'arrow'), holdBtn('↓', 'down', 'arrow blue'), holdBtn('→', 'right', 'arrow'));
      this.controls.append(pad, holdBtn('집기', 'drop', 'drop'));
      this.help.innerHTML = '<b>Enter</b> 동전 · <b>방향키</b> 이동 · <b>Space</b> 집기<br><b>V</b> 시점 전환 · <b>R</b> 리플레이';
    }
    this.camBtn = el('button', 'btn ghost', '시점: 정면');
    this.camBtn.onclick = () => this.h.camera();
    this.controls.append(this.camBtn);
  }

  private setPrice(price: number) {
    if (this.coinBtn) this.coinBtn.textContent = `동전 넣기 ${won(price)}`;
  }

  setCameraLabel(label: string) {
    if (this.camBtn) this.camBtn.textContent = `시점: ${label}`;
  }

  setMode(real: boolean, machineLabel: string) {
    this.badge.textContent = real ? '실전' : '연습';
    this.badge.classList.toggle('real', real);
    this.machineName.textContent = machineLabel;
    this.meter.style.display = real ? 'none' : '';
  }

  setStats(s: Stats) {
    this.statEls.attempts.textContent = String(s.attempts);
    this.statEls.wins.textContent = String(s.wins);
    this.statEls.rate.textContent = s.attempts ? `${Math.round((s.wins / s.attempts) * 100)}%` : '-';
    this.statEls.spent.textContent = won(s.spent);
  }

  setPhase(phase: Phase, timeLeft: number, strong: boolean, busy: boolean) {
    this.phaseEl.textContent = PHASE_LABEL[phase];
    const timed = phase === 'moveX' || phase === 'moveZ' || phase === 'move';
    this.timerEl.textContent = timed ? `남은 시간 ${timeLeft.toFixed(1)}초` : busy ? '' : 'Enter 또는 동전 버튼';
    this.strongEl.style.display = strong ? 'block' : 'none';
    if (this.coinBtn) this.coinBtn.disabled = busy;
  }

  setMeter(power: number, swingDeg: number) {
    const pct = Math.round(power * 100);
    this.meterFill.style.width = `${Math.min(100, pct)}%`;
    this.meterVal.textContent = `${pct}%`;
    this.swingVal.textContent = `${swingDeg.toFixed(1)}°`;
  }

  showResult(r: AttemptResult, opts: { real: boolean; hasReplay: boolean; onAgain: () => void }) {
    const e = this.resultEl;
    e.innerHTML = '';
    const card = el('div', 'card');
    const h2 = el('h2', r.success ? 'win' : 'lose', (r.success ? '🎉 ' : '') + r.title);
    card.append(h2);
    if (r.strongTurn && !opts.real) card.append(el('div', 'strongnote', '⚡ 이번 판은 확률 세팅상 강집게 차례였어요'));
    card.append(el('div', 'detail', r.detail));
    if (r.tips.length) {
      const ul = el('ul');
      for (const t of r.tips) ul.append(el('li', '', t));
      card.append(ul);
    }
    const canvas = el('canvas');
    canvas.id = 'chart';
    card.append(canvas);
    const legend = el('div', 'legend');
    if (!opts.real) legend.innerHTML += '<span><i style="background:var(--pink)"></i>집게 힘(%)</span>';
    const maxSwing = Math.max(0, ...r.trace.map((p) => p.swing));
    legend.innerHTML += `<span><i style="background:var(--blue)"></i>잡힌 경품 높이</span><span><i style="background:var(--gold)"></i>줄 흔들림 (최대 ${maxSwing.toFixed(0)}°)</span>`;
    card.append(legend);

    const row = el('div', 'row');
    if (opts.hasReplay) {
      const rb = el('button', 'btn ghost', '▶ 리플레이 (R)');
      rb.onclick = () => this.h.replay();
      row.append(rb);
    }
    const close = el('button', 'btn ghost', '닫기');
    close.onclick = () => this.hideResult();
    const again = el('button', 'btn coin', '한 판 더');
    again.onclick = () => { this.hideResult(); opts.onAgain(); };
    row.append(close, again);
    card.append(row);
    e.append(card);
    e.classList.add('show');
    requestAnimationFrame(() => drawChart(canvas, r, opts.real));
  }

  hideResult() { this.resultEl.classList.remove('show'); }
  get resultOpen() { return this.resultEl.classList.contains('show'); }

  showReplay(frames: number) {
    this.replayRange.max = String(Math.max(0, frames - 1));
    this.replayRange.value = '0';
    this.replayEl.classList.add('show');
    this.controls.style.display = 'none';
  }

  updateReplay(frame: number, phase: Phase, playing: boolean) {
    this.replayRange.value = String(Math.floor(frame));
    this.replayPhase.textContent = PHASE_LABEL[phase];
    this.replayPlay.textContent = playing ? '⏸' : '▶';
  }

  hideReplay() {
    this.replayEl.classList.remove('show');
    this.controls.style.display = '';
  }
}

const PHASE_SHORT: Partial<Record<Phase, string>> = {
  drop: '하강', grab: '집기', lift: '상승', top: '꼭대기', return: '이동', release: '놓기',
};

function drawChart(canvas: HTMLCanvasElement, r: AttemptResult, real: boolean) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  const tr = r.trace.filter((p) => p.phase !== 'moveX' && p.phase !== 'moveZ' && p.phase !== 'move');
  if (tr.length < 2) return;
  const t0 = tr[0].t, t1 = tr[tr.length - 1].t;
  const padL = 34, padR = 34, padT = 20, padB = 18;
  const X = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * (w - padL - padR);
  const plotH = h - padT - padB;
  const maxLift = Math.max(0.05, ...tr.map((p) => p.lift));
  const maxSwing = Math.max(10, ...tr.map((p) => p.swing));

  // 구간 배경
  let start = 0;
  for (let i = 1; i <= tr.length; i++) {
    if (i === tr.length || tr[i].phase !== tr[start].phase) {
      const a = X(tr[start].t), b = X(tr[i - 1].t);
      g.fillStyle = Object.keys(PHASE_SHORT).indexOf(tr[start].phase) % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.07)';
      g.fillRect(a, padT, b - a, plotH);
      const label = PHASE_SHORT[tr[start].phase];
      if (label && b - a > 24) {
        g.fillStyle = '#b3aac2';
        g.font = '11px sans-serif';
        g.textAlign = 'center';
        g.fillText(label, (a + b) / 2, 13);
      }
      start = i;
    }
  }

  const line = (vals: number[], max: number, color: string) => {
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.beginPath();
    tr.forEach((p, i) => {
      const x = X(p.t), y = padT + plotH - (vals[i] / max) * plotH;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.stroke();
  };
  line(tr.map((p) => p.swing), maxSwing, 'rgba(255,212,59,0.8)');
  line(tr.map((p) => p.lift), maxLift, '#4dabf7');
  if (!real) line(tr.map((p) => p.power), 1, '#ff4d8d');

  g.font = '10px sans-serif';
  g.fillStyle = '#b3aac2';
  g.textAlign = 'left';
  if (!real) { g.fillText('100%', 2, padT + 8); g.fillText('0', 2, padT + plotH); }
  g.textAlign = 'right';
  g.fillText(`${(maxLift * 100).toFixed(0)}cm`, w - 2, padT + 8);
  g.fillText(`${(t1 - t0).toFixed(1)}s`, w - 2, h - 4);
}

import { PRIZES } from '../prizes/shapes';
import type { PrizeKind } from '../machine/settings';
import { carpetCanvas, roundRect, signCanvas, signColors, type ArcadeMachine } from './arcade';

/**
 * 오락실 2D 화면. 위에서 비스듬히 내려다본 모습 (바닥 깊이는 YS배, 높이는 K배로 그림).
 * 좌표는 미터 단위 바닥 좌표: x 오른쪽, y 아래(화면 앞쪽). 기계 앞면은 모두 아래(+y)를 본다.
 * 캐릭터는 방향키로 8방향 어디로든 바로 걷고, 기계 앞에 서면 그 기계를 플레이할 수 있다.
 */

// 약 40°로 내려다보는 카메라: 바닥 앞뒤 깊이는 YS배로 줄고, 높이는 K배로 세워 그린다
const YS = 0.64;
const K = 0.77;
const SPEED = 2.4;       // 걷는 속도 (m/s)
const R = 0.22;          // 캐릭터 충돌 반지름

interface Slot {
  m: ArcadeMachine;
  x: number; y: number;  // 바닥 사각형 왼쪽 위 (뒤쪽 모서리)
  w: number; d: number;  // 가로, 앞뒤 깊이
  h: number;             // 높이 (받침대 포함)
  stand: number;         // 받침대 높이
  prizes: { x: number; y: number; r: number; color: string; shape: 'plush' | 'box' | 'capsule' }[];
}

type Dir = 'down' | 'up' | 'left' | 'right';

export interface MoveInput { up: boolean; down: boolean; left: boolean; right: boolean }

export class Lobby2D {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private slots: Slot[] = [];
  private roomW = 11.6;
  private roomH = 8.0;
  private zoom = 80;
  private cam = { x: 0, y: 0 };
  private carpet: CanvasPattern;
  private signs = new Map<ArcadeMachine, HTMLCanvasElement>();
  readonly player = { x: 5.8, y: 7.2, dir: 'up' as Dir, walk: 0, moving: false };
  near: ArcadeMachine | null = null;

  constructor(parent: HTMLElement, machines: ArcadeMachine[]) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'lobby';
    parent.insertBefore(this.canvas, parent.children[1] ?? null);
    this.g = this.canvas.getContext('2d')!;
    this.carpet = this.g.createPattern(carpetCanvas(), 'repeat')!;
    this.layout(machines);
    this.refreshSigns(false);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private layout(machines: ArcadeMachine[]) {
    const rows = [machines.filter((m) => !m.mini), machines.filter((m) => m.mini)];
    const rowY = [0.25, 5.0];
    rows.forEach((row, r) => {
      const mini = r === 1;
      const w = mini ? 0.62 : 1.0, d = mini ? 0.55 : 0.9, h = mini ? 1.45 : 1.9, gap = mini ? 0.75 : 0.55;
      const total = row.length * w + (row.length - 1) * gap;
      let x = (this.roomW - total) / 2;
      for (const m of row) {
        this.slots.push({ m, x, y: rowY[r], w, d, h, stand: mini ? 0.5 : 0, prizes: prizeDots(m) });
        x += w + gap;
      }
    });
  }

  refreshSigns(real: boolean) {
    for (const s of this.slots) this.signs.set(s.m, signCanvas(s.m.preset, s.m.settings, real));
  }

  setVisible(v: boolean) {
    this.canvas.style.display = v ? '' : 'none';
  }

  /** 이 기계 앞에 서서 기계를 바라보게 */
  placeAt(m: ArcadeMachine) {
    const s = this.slots.find((q) => q.m === m);
    if (!s) return;
    this.player.x = s.x + s.w / 2;
    this.player.y = s.y + s.d + 0.4;
    this.player.dir = 'up';
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.zoom = w < 720 ? 62 : 84;
  }

  // ---------- 이동 ----------
  update(dt: number, input: MoveInput) {
    const p = this.player;
    let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    p.moving = dx !== 0 || dy !== 0;
    if (p.moving) {
      const len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      // 축마다 따로 움직여서 벽이나 기계를 따라 미끄러지게
      this.tryMove(p.x + dx * SPEED * dt, p.y);
      this.tryMove(p.x, p.y + dy * SPEED * dt);
      p.walk += dt * 10;
    } else {
      p.walk = 0;
    }
    this.near = this.findNear();
  }

  private blocked(x: number, y: number) {
    if (x < R + 0.1 || x > this.roomW - R - 0.1 || y < 0.3 || y > this.roomH - 0.15) return true;
    for (const s of this.slots) {
      // 캐릭터 발(원)과 기계 바닥 사각형
      const cx = Math.max(s.x, Math.min(x, s.x + s.w));
      const cy = Math.max(s.y, Math.min(y, s.y + s.d));
      if (Math.hypot(x - cx, (y - cy) * 1.6) < R) return true;
    }
    return false;
  }

  private tryMove(x: number, y: number) {
    if (!this.blocked(x, y)) { this.player.x = x; this.player.y = y; }
  }

  private findNear(): ArcadeMachine | null {
    const p = this.player;
    let best: ArcadeMachine | null = null, bestD = Infinity;
    for (const s of this.slots) {
      const front = s.y + s.d;
      if (p.y < front || p.y > front + 0.75) continue;
      const dx = Math.abs(p.x - (s.x + s.w / 2));
      if (dx > s.w / 2 + 0.2) continue;
      const d = dx + (p.y - front);
      if (d < bestD) { best = s.m; bestD = d; }
    }
    return best;
  }

  // ---------- 그리기 ----------
  private sx(x: number) { return (x - this.cam.x) * this.zoom; }
  private sy(y: number) { return (y - this.cam.y) * this.zoom * YS; }

  draw(now: number) {
    const g = this.g;
    const vw = window.innerWidth / this.zoom, vh = window.innerHeight / (this.zoom * YS);
    // 카메라는 캐릭터를 따라가되 오락실 밖은 최대한 안 보이게
    const top = -3.4, bottom = this.roomH + 0.5;
    const clampCam = (v: number, lo: number, hi: number, view: number) => (hi - lo <= view ? (lo + hi - view) / 2 : Math.max(lo, Math.min(hi - view, v)));
    this.cam.x = clampCam(this.player.x - vw / 2, -0.4, this.roomW + 0.4, vw);
    this.cam.y = clampCam(this.player.y - vh * 0.6, top, bottom, vh);
    const z = this.zoom;

    g.fillStyle = '#140f1c';
    g.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // 뒷벽
    const wallTop = -3.4;
    const wg = g.createLinearGradient(0, this.sy(wallTop), 0, this.sy(0));
    wg.addColorStop(0, '#1e1830');
    wg.addColorStop(1, '#2d2446');
    g.fillStyle = wg;
    g.fillRect(this.sx(0), this.sy(wallTop), this.roomW * z, -wallTop * z * YS);
    // 네온 띠 + 벽 간판
    g.fillStyle = '#ff4d8d';
    g.shadowColor = '#ff4d8d';
    g.shadowBlur = 12;
    g.fillRect(this.sx(0), this.sy(-3.0), this.roomW * z, 0.04 * z);
    g.shadowBlur = 0;

    // 바닥 (카펫)
    g.save();
    g.translate(this.sx(0), this.sy(0));
    g.fillStyle = this.carpet;
    const pz = z / 170; // 카펫 무늬 한 칸 ≈ 1.5m
    g.scale(pz, pz * YS);
    g.fillRect(0, 0, (this.roomW * z) / pz, (this.roomH * z) / pz);
    g.restore();
    // 옆벽·앞벽 테두리
    g.fillStyle = '#2a2140';
    g.fillRect(this.sx(-0.3), this.sy(wallTop), 0.3 * z, (this.roomH - wallTop) * z * YS);
    g.fillRect(this.sx(this.roomW), this.sy(wallTop), 0.3 * z, (this.roomH - wallTop) * z * YS);
    g.fillRect(this.sx(-0.3), this.sy(this.roomH), (this.roomW + 0.6) * z, 0.5 * z * YS);
    // 입구 매트
    g.fillStyle = '#3bc9db';
    roundRect(g, this.sx(this.roomW / 2 - 0.7), this.sy(this.roomH - 0.55), 1.4 * z, 0.5 * z * YS, 0.08 * z);
    g.fill();
    g.fillStyle = '#0b3d44';
    g.font = `bold ${Math.round(0.2 * z)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('어서 오세요', this.sx(this.roomW / 2), this.sy(this.roomH - 0.3));

    // 앞에 선 기계 바닥 표시
    if (this.near) {
      const s = this.slots.find((q) => q.m === this.near)!;
      const pulse = 0.5 + 0.5 * Math.sin(now / 180);
      g.fillStyle = `rgba(255, 212, 59, ${0.25 + 0.2 * pulse})`;
      roundRect(g, this.sx(s.x - 0.05), this.sy(s.y + s.d + 0.05), (s.w + 0.1) * z, 0.7 * z * YS, 0.1 * z);
      g.fill();
    }

    // 기계와 캐릭터를 앞뒤 순서대로 (뒤에 있는 것부터)
    const items: { y: number; draw: () => void }[] = this.slots.map((s) => ({ y: s.y + s.d, draw: () => this.drawMachine(s, now) }));
    items.push({ y: this.player.y, draw: () => this.drawPlayer(now) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
  }

  private drawMachine(s: Slot, now: number) {
    const g = this.g, z = this.zoom;
    const near = this.near === s.m;
    const x0 = this.sx(s.x), x1 = this.sx(s.x + s.w);
    const w = x1 - x0;
    const yFront = this.sy(s.y + s.d);
    const hPx = s.h * K * z;
    const dPx = s.d * z * YS;
    const standPx = s.stand * K * z;
    const [c1] = signColors(s.m.mini);

    // 그림자
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(x0 + w / 2, yFront - dPx / 2, w * 0.62, dPx * 0.62, 0, 0, Math.PI * 2);
    g.fill();

    // 받침대 (미니)
    if (standPx > 0) {
      g.fillStyle = '#2a2433';
      g.fillRect(x0 + w * 0.04, yFront - standPx, w * 0.92, standPx);
      g.fillStyle = '#3a3346';
      g.fillRect(x0 + w * 0.04, yFront - standPx - dPx, w * 0.92, dPx);
    }
    const bodyBottom = yFront - standPx;
    const bodyH = hPx - standPx;
    const faceTop = yFront - hPx;

    // 지붕 (윗면)
    g.fillStyle = '#ff7aa2';
    g.fillRect(x0, faceTop - dPx, w, dPx);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x0, faceTop - dPx, w, dPx * 0.25);

    // 앞면: 아래 캐비닛 / 유리창 / 위 헤더
    const baseH = bodyH * 0.38, headH = bodyH * 0.14, glassH = bodyH - baseH - headH;
    const glassTop = faceTop + headH;
    // 캐비닛
    g.fillStyle = '#e8356f';
    g.fillRect(x0, bodyBottom - baseH, w, baseH);
    g.fillStyle = '#c2255c';
    g.fillRect(x0, bodyBottom - baseH * 0.25, w, baseH * 0.25);
    // 경품 나오는 문
    g.fillStyle = '#1b1b24';
    roundRect(g, x0 + w * 0.08, bodyBottom - baseH * 0.62, w * 0.3, baseH * 0.32, 3);
    g.fill();
    // 조작 패널
    g.fillStyle = '#f1f3f5';
    g.fillRect(x0 - w * 0.03, bodyBottom - baseH - 4, w * 1.06, 7);
    g.fillStyle = '#ff4d8d';
    g.beginPath(); g.arc(x0 + w * 0.7, bodyBottom - baseH - 1, Math.max(2, w * 0.05), 0, Math.PI * 2); g.fill();
    // 유리창
    g.fillStyle = '#2c2f45';
    g.fillRect(x0 + w * 0.05, glassTop, w * 0.9, glassH);
    const gg = g.createLinearGradient(0, glassTop, 0, glassTop + glassH);
    gg.addColorStop(0, 'rgba(180, 220, 255, 0.28)');
    gg.addColorStop(1, 'rgba(180, 220, 255, 0.08)');
    // 경품
    g.save();
    g.beginPath();
    g.rect(x0 + w * 0.05, glassTop, w * 0.9, glassH);
    g.clip();
    const floorY = glassTop + glassH;
    for (const p of s.prizes) {
      const px = x0 + w * (0.05 + 0.9 * p.x);
      const py = floorY - p.y * glassH * 0.55;
      const r = p.r * w;
      g.fillStyle = p.color;
      if (p.shape === 'box') {
        g.fillRect(px - r, py - r * 1.6, r * 2, r * 1.8);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.fillRect(px - r, py - r * 0.9, r * 2, r * 0.35);
      } else if (p.shape === 'capsule') {
        g.beginPath(); g.arc(px, py - r, r, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath(); g.arc(px, py - r, r, Math.PI, 0); g.fill();
      } else {
        // 인형: 몸 + 머리 + 귀
        g.beginPath(); g.ellipse(px, py - r * 0.7, r, r * 0.8, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(px, py - r * 1.9, r * 0.75, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(px - r * 0.55, py - r * 2.5, r * 0.3, 0, Math.PI * 2); g.arc(px + r * 0.55, py - r * 2.5, r * 0.3, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#222';
        g.fillRect(px - r * 0.3, py - r * 2, Math.max(1, r * 0.15), Math.max(1, r * 0.15));
        g.fillRect(px + r * 0.18, py - r * 2, Math.max(1, r * 0.15), Math.max(1, r * 0.15));
      }
    }
    // 집게 (살짝 흔들림)
    const sway = Math.sin(now / 900 + s.x) * w * 0.03;
    const cx = x0 + w * 0.3 + sway;
    g.strokeStyle = '#555';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx, glassTop); g.lineTo(cx, glassTop + glassH * 0.22); g.stroke();
    g.fillStyle = '#ced4da';
    g.fillRect(cx - w * 0.06, glassTop + glassH * 0.22, w * 0.12, w * 0.08);
    g.strokeStyle = '#adb5bd';
    g.lineWidth = Math.max(1.5, w * 0.025);
    g.beginPath();
    g.moveTo(cx - w * 0.05, glassTop + glassH * 0.22 + w * 0.08); g.lineTo(cx - w * 0.09, glassTop + glassH * 0.22 + w * 0.2);
    g.moveTo(cx + w * 0.05, glassTop + glassH * 0.22 + w * 0.08); g.lineTo(cx + w * 0.09, glassTop + glassH * 0.22 + w * 0.2);
    g.stroke();
    g.restore();
    g.fillStyle = gg;
    g.fillRect(x0 + w * 0.05, glassTop, w * 0.9, glassH);
    // 기둥
    g.fillStyle = '#ff4d8d';
    g.fillRect(x0, glassTop, w * 0.05, glassH);
    g.fillRect(x1 - w * 0.05, glassTop, w * 0.05, glassH);
    // 헤더
    const hg = g.createLinearGradient(x0, 0, x1, 0);
    hg.addColorStop(0, '#ff4d8d');
    hg.addColorStop(1, '#ffb347');
    g.fillStyle = hg;
    g.fillRect(x0, faceTop, w, headH);
    g.fillStyle = '#fff';
    g.font = `bold ${Math.max(8, Math.round(headH * 0.6))}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s.m.mini ? '미니뽑기' : '인형뽑기', x0 + w / 2, faceTop + headH / 2 + 1);

    // 앞에 서 있으면 테두리가 빛난다
    if (near) {
      g.strokeStyle = '#ffd43b';
      g.shadowColor = '#ffd43b';
      g.shadowBlur = 14;
      g.lineWidth = 3;
      g.strokeRect(x0 - 2, faceTop - dPx - 2, w + 4, bodyBottom - faceTop + dPx + 4);
      g.shadowBlur = 0;
    }

    // 간판 (지붕 위)
    const sign = this.signs.get(s.m)!;
    const sw = Math.max(w * 1.25, 1.22 * z);
    const sh = sw / 2;
    const sTop = faceTop - dPx - sh - 0.04 * z;
    g.fillStyle = '#555';
    g.fillRect(x0 + w / 2 - 2, sTop + sh, 4, faceTop - dPx - (sTop + sh));
    g.drawImage(sign, x0 + w / 2 - sw / 2, sTop, sw, sh);
    if (near) {
      g.strokeStyle = c1;
      g.lineWidth = 2;
      roundRect(g, x0 + w / 2 - sw / 2 - 2, sTop - 2, sw + 4, sh + 4, sh * 0.14);
      g.stroke();
    }
  }

  private drawPlayer(now: number) {
    const g = this.g, z = this.zoom;
    const p = this.player;
    const x = this.sx(p.x), y = this.sy(p.y);
    const u = z * 0.01; // 1cm
    const step = p.moving ? Math.sin(p.walk) : 0;
    const bob = p.moving ? Math.abs(Math.cos(p.walk)) * 2.5 * u : Math.sin(now / 500) * 0.8 * u;

    // 그림자
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(x, y, 22 * u, 8 * u, 0, 0, Math.PI * 2); g.fill();

    const skin = '#ffd9bd', hoodie = '#ff7aa2', hoodieDark = '#e85d88', jeans = '#3d5a8a', shoe = '#f8f9fa', hair = '#3b2418';
    const side = p.dir === 'left' || p.dir === 'right';
    const flip = p.dir === 'left' ? -1 : 1;
    const hipY = y - 26 * u - bob;

    // 다리 (걸을 때 번갈아 앞뒤로)
    const leg = (dx: number, lift: number, fwd: number) => {
      g.fillStyle = jeans;
      roundRect(g, x + dx - 6 * u + fwd, hipY, 12 * u, 24 * u - lift, 5 * u);
      g.fill();
      g.fillStyle = shoe;
      g.beginPath();
      g.ellipse(x + dx + fwd + (side ? flip * 3 * u : 0), hipY + 24 * u - lift, (side ? 10 : 7) * u, 4.5 * u, 0, 0, Math.PI * 2);
      g.fill();
    };
    if (side) {
      leg(0, Math.max(0, -step) * 5 * u, -step * 8 * u * flip);
      leg(0, Math.max(0, step) * 5 * u, step * 8 * u * flip);
    } else {
      leg(-7 * u, Math.max(0, step) * 6 * u, 0);
      leg(7 * u, Math.max(0, -step) * 6 * u, 0);
    }

    // 몸통 (후드티)
    const bodyTop = hipY - 32 * u;
    g.fillStyle = hoodie;
    roundRect(g, x - (side ? 13 : 17) * u, bodyTop, (side ? 26 : 34) * u, 36 * u, 10 * u);
    g.fill();
    g.fillStyle = hoodieDark;
    g.fillRect(x - (side ? 13 : 17) * u, hipY - 2 * u, (side ? 26 : 34) * u, 5 * u);
    if (p.dir === 'down') {
      roundRect(g, x - 9 * u, hipY - 13 * u, 18 * u, 9 * u, 3 * u); // 주머니
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 1.2 * u;
      g.beginPath(); g.moveTo(x - 4 * u, bodyTop + 4 * u); g.lineTo(x - 4 * u, bodyTop + 13 * u); g.moveTo(x + 4 * u, bodyTop + 4 * u); g.lineTo(x + 4 * u, bodyTop + 13 * u); g.stroke();
    }
    // 팔 (다리와 반대로 흔들림)
    const arm = (dx: number, swing: number) => {
      g.fillStyle = hoodie;
      g.save();
      g.translate(x + dx, bodyTop + 5 * u);
      g.rotate(swing);
      roundRect(g, -5 * u, 0, 10 * u, 26 * u, 5 * u);
      g.fill();
      g.fillStyle = skin;
      g.beginPath(); g.arc(0, 27 * u, 5 * u, 0, Math.PI * 2); g.fill();
      g.restore();
    };
    if (side) arm(-2 * u * flip, step * 0.5 * flip);
    else {
      arm(-19 * u, 0.12 + step * 0.12);
      arm(19 * u, -0.12 - step * 0.12);
    }

    // 머리 (크게)
    const hy = bodyTop - 20 * u;
    const hr = 22 * u;
    g.fillStyle = skin;
    g.beginPath(); g.arc(x, hy, hr, 0, Math.PI * 2); g.fill();
    g.fillStyle = hair;
    if (p.dir === 'up') {
      g.beginPath(); g.arc(x, hy - 1 * u, hr + 1.5 * u, 0, Math.PI * 2); g.fill();
    } else if (p.dir === 'down') {
      // 앞머리가 있는 머리카락 + 얼굴
      g.beginPath(); g.arc(x, hy - 2 * u, hr + 1.5 * u, Math.PI * 1.02, Math.PI * 1.98); g.closePath(); g.fill();
      for (const bx of [-12, -4, 4, 12]) {
        g.beginPath(); g.ellipse(x + bx * u, hy - 8 * u, 6 * u, 7 * u, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#2b1d14';
      for (const ex of [-8, 8]) {
        g.beginPath(); g.ellipse(x + ex * u, hy + 4 * u, 2.6 * u, 3.6 * u, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#fff';
      for (const ex of [-8, 8]) { g.beginPath(); g.arc(x + (ex - 1) * u, hy + 2.6 * u, 1 * u, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(255,120,140,0.45)';
      for (const ex of [-13, 13]) { g.beginPath(); g.ellipse(x + ex * u, hy + 10 * u, 4 * u, 2.5 * u, 0, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = '#a0413c';
      g.lineWidth = 1.4 * u;
      g.beginPath(); g.arc(x, hy + 9 * u, 3.5 * u, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
    } else {
      // 옆모습: 뒤통수 쪽 머리카락, 눈 하나
      g.beginPath(); g.arc(x - flip * 3 * u, hy - 3 * u, hr + 1 * u, 0, Math.PI * 2); g.fill();
      g.fillStyle = skin;
      g.beginPath(); g.ellipse(x + flip * 7 * u, hy + 4 * u, 15 * u, 15 * u, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = hair;
      g.beginPath(); g.ellipse(x + flip * 8 * u, hy - 10 * u, 14 * u, 6 * u, flip * 0.3, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b1d14';
      g.beginPath(); g.ellipse(x + flip * 13 * u, hy + 3 * u, 2.4 * u, 3.4 * u, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,120,140,0.45)';
      g.beginPath(); g.ellipse(x + flip * 12 * u, hy + 10 * u, 3.5 * u, 2.2 * u, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = skin;
      g.beginPath(); g.ellipse(x - flip * 3 * u, hy + 3 * u, 4 * u, 5 * u, 0, 0, Math.PI * 2); g.fill(); // 귀
    }

    // 기계 앞이면 머리 위에 말풍선
    if (this.near) {
      const t = '플레이!';
      g.font = `bold ${Math.round(13 * u * 1.1)}px sans-serif`;
      const tw = g.measureText(t).width + 14 * u;
      const by = hy - hr - 20 * u + Math.sin(now / 200) * 2 * u;
      g.fillStyle = '#ffd43b';
      roundRect(g, x - tw / 2, by - 10 * u, tw, 20 * u, 8 * u);
      g.fill();
      g.beginPath(); g.moveTo(x - 4 * u, by + 10 * u); g.lineTo(x + 4 * u, by + 10 * u); g.lineTo(x, by + 15 * u); g.fill();
      g.fillStyle = '#1b1426';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, x, by + 1 * u);
    }
  }
}

/** 기계 유리창 안에 그릴 경품 모양 (기계마다 고정된 배치) */
function prizeDots(m: ArcadeMachine): Slot['prizes'] {
  let seed = 11 + m.index * 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const kinds = (Object.entries(m.settings.prizeMix) as [PrizeKind, number][]).filter(([, n]) => n > 0).map(([k]) => k);
  const out: Slot['prizes'] = [];
  const n = m.mini ? 7 : 8;
  for (let i = 0; i < n; i++) {
    const def = PRIZES[kinds[i % kinds.length]];
    const color = '#' + def.colors[Math.floor(rnd() * def.colors.length)].toString(16).padStart(6, '0');
    out.push({
      x: 0.28 + ((i + rnd() * 0.6) / n) * 0.68, // 왼쪽 앞은 배출구라 비워 둔다
      y: rnd() * 0.5,
      r: (m.mini ? 0.06 : 0.055) * (def.category === 'capsule' ? 0.8 : 1),
      color,
      shape: def.category,
    });
  }
  // 뒤에 있는 것(위쪽)부터 그리게
  out.sort((a, b) => b.y - a.y);
  return out;
}

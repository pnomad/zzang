import * as THREE from 'three';
import { PRESETS, type MachineSettings, type Preset } from '../machine/settings';
import { Rig } from '../game/rig';
import type { PayoutState } from '../game/controller';

/**
 * 오락실의 기계 한 대. 오락실은 2D 화면(lobby2d)에서 걸어 다니고,
 * 기계 앞에서 플레이를 시작하면 이 기계의 3D 물리 기계(Rig)를 원점에 만들어 보여 준다.
 * 한 번 만든 기계는 나와도 남겨 두어서 다시 들어가면 경품 배치가 그대로다.
 */

const PRIZE_FLOOR = 0.92;  // 경품 바닥 높이. 미니 기계는 받침대에 올려 높이를 맞춘다

export class ArcadeMachine {
  readonly group = new THREE.Group();
  rig: Rig | null = null;
  /** 세팅이 바뀌어 다음에 들어갈 때 다시 만들어야 함 */
  dirty = true;
  /** 연습 모드에서 이 기계의 세팅 (저장 대상) */
  practice: MachineSettings;
  /** 지금 적용 중인 세팅 (실전 모드면 무작위로 숨겨진 세팅) */
  settings: MachineSettings;
  readonly payout: PayoutState = { playsSinceWin: 0, spentSinceWin: 0 };
  private extras: THREE.Object3D[] = [];

  constructor(readonly index: number, readonly preset: Preset, practice: MachineSettings) {
    this.practice = practice;
    this.settings = practice;
    this.group.visible = false;
  }

  get title() { return this.preset.title; }
  get mini() { return this.settings.kind === 'mini'; }

  /** 로컬 → 월드 */
  toWorld(v: THREE.Vector3) { return this.group.localToWorld(v); }

  /** 물리 기계를 (다시) 만든다. 경품이 가라앉을 때까지 미리 돌리므로 조금 걸린다. */
  build(real: boolean) {
    this.rig?.dispose();
    for (const e of this.extras) this.group.remove(e);
    this.extras = [];
    this.payout.playsSinceWin = 0;
    this.payout.spentSinceWin = 0;
    this.payout.target = undefined;
    this.dirty = false;

    const rig = (this.rig = new Rig(this.group, this.settings));
    const g = rig.geom;
    const sc = g.width / 0.8;
    const bottom = rig.cabinet.bottomY;
    const elev = Math.max(PRIZE_FLOOR, -bottom);
    this.group.position.y = elev;
    this.group.updateMatrixWorld();

    // 받침대 (미니 기계)
    const standH = elev + bottom;
    if (standH > 0.005) {
      const stand = new THREE.Mesh(
        new THREE.BoxGeometry(rig.cabinet.outerSize.x, standH, g.depth + 0.12 * sc),
        new THREE.MeshStandardMaterial({ color: 0x2a2433, roughness: 0.7 }),
      );
      stand.position.y = bottom - standH / 2;
      stand.castShadow = stand.receiveShadow = true;
      this.add(stand);
    }

    // 간판
    const signW = Math.max(0.55, g.width + 0.12 * sc);
    const signH = signW * 0.5;
    const tex = new THREE.CanvasTexture(signCanvas(this.preset, this.settings, real));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    sign.position.set(0, g.height + 0.03 + 0.18 * sc + 0.04 + signH / 2, g.depth / 2 + 0.07 * sc);
    this.add(sign);
    rig.syncAll();
  }

  private add(o: THREE.Object3D) {
    this.group.add(o);
    this.extras.push(o);
  }
}

export function createMachines(scene: THREE.Scene, loadPractice: (i: number) => MachineSettings): ArcadeMachine[] {
  return PRESETS.map((p, i) => {
    const m = new ArcadeMachine(i, p, loadPractice(i));
    scene.add(m.group);
    return m;
  });
}

export const signColors = (mini: boolean): [string, string] => (mini ? ['#12b886', '#3bc9db'] : ['#ff4d8d', '#ff922b']);

export function difficultyText(p: Preset, real: boolean) {
  return real ? '난이도 ???' : '★'.repeat(p.difficulty) + '☆'.repeat(3 - p.difficulty) + ' ' + ['쉬움', '보통', '어려움'][p.difficulty - 1];
}

/** 간판 그림 (3D 간판 텍스처와 2D 오락실 화면이 같이 쓴다). 512×256 */
export function signCanvas(p: Preset, s: MachineSettings, real: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const mini = s.kind === 'mini';
  const [c1, c2] = signColors(mini);
  const grad = g.createLinearGradient(0, 0, 512, 256);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  g.fillStyle = '#1a1422';
  roundRect(g, 0, 0, 512, 256, 34);
  g.fill();
  g.fillStyle = grad;
  roundRect(g, 10, 10, 492, 236, 26);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.22)';
  roundRect(g, 26, 150, 460, 82, 18);
  g.fill();

  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.35)';
  // 기계 크기 뱃지
  g.font = 'bold 30px sans-serif';
  const badge = mini ? '미니' : '일반';
  const bw = g.measureText(badge).width + 28;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(g, 30, 30, bw, 44, 22);
  g.fill();
  g.fillStyle = c1;
  g.textAlign = 'left';
  g.fillText(badge, 44, 53);
  // 경품 이름
  g.shadowBlur = 8;
  g.fillStyle = '#fff';
  g.font = 'bold 66px sans-serif';
  g.textAlign = 'center';
  g.fillText(p.title, 256, 108);
  // 난이도 · 가격
  g.shadowBlur = 0;
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'left';
  g.fillStyle = real ? '#e9ecef' : '#ffe066';
  g.fillText(difficultyText(p, real), 46, 191);
  g.textAlign = 'right';
  g.fillStyle = '#fff';
  g.fillText(`1회 ₩${s.price.toLocaleString('ko-KR')}`, 466, 191);
  return c;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 오락실 카펫 무늬 (3D 바닥과 2D 오락실 바닥이 같이 쓴다) */
export function carpetCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#231a33';
  g.fillRect(0, 0, 256, 256);
  const cols = ['#ff4d8d', '#3bc9db', '#ffd43b', '#9775fa'];
  // 오락실 카펫 특유의 흩어진 도형 무늬 (고정 시드로 매번 같은 무늬)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = cols[i % cols.length];
    g.globalAlpha = 0.55;
    g.lineWidth = 3;
    const x = rnd() * 256, y = rnd() * 256, r = 5 + rnd() * 9;
    g.beginPath();
    if (i % 3 === 0) g.arc(x, y, r, 0, Math.PI * 2);
    else if (i % 3 === 1) { g.moveTo(x - r, y + r); g.lineTo(x, y - r); g.lineTo(x + r, y + r); g.closePath(); }
    else { g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); }
    g.stroke();
  }
  return c;
}

/** 3D 플레이 화면 뒤로 보이는 오락실 (바닥·벽). 기계는 원점에 놓인다 */
export function buildRoom(scene: THREE.Scene) {
  const hx = 3.5, zBack = -1.2, zFront = 4;
  const tex = new THREE.CanvasTexture(carpetCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((hx * 2) / 1.5, (zFront - zBack) / 1.5);
  tex.anisotropy = 4;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(hx * 2, zFront - zBack),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = (zBack + zFront) / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2140, roughness: 0.9 });
  const neon = [0xff4d8d, 0x3bc9db, 0xffd43b];
  const wall = (w: number, x: number, z: number, ry: number, i: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.2), wallMat);
    m.position.set(x, 1.6, z);
    m.rotation.y = ry;
    scene.add(m);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.05), new THREE.MeshBasicMaterial({ color: neon[i % 3], toneMapped: false }));
    strip.position.set(x, 2.5, z);
    strip.rotation.y = ry;
    strip.translateZ(0.01);
    scene.add(strip);
  };
  const cz = (zBack + zFront) / 2, dz = zFront - zBack;
  wall(hx * 2, 0, zBack, 0, 0);
  wall(hx * 2, 0, zFront, Math.PI, 1);
  wall(dz, -hx, cz, Math.PI / 2, 2);
  wall(dz, hx, cz, -Math.PI / 2, 0);
}

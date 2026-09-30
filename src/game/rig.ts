import * as THREE from 'three';
import { RAPIER, DT, createWorld, syncObject, type Synced } from '../physics/world';
import { buildCabinet, type Cabinet } from '../machine/cabinet';
import { Claw } from '../machine/claw';
import { Gantry } from '../machine/gantry';
import { GEOMETRY, type MachineGeometry, type MachineSettings, type PrizeKind } from '../machine/settings';
import { spawnPrize, removePrize, type Prize } from '../prizes/ragdoll';
import { PRIZES } from '../prizes/shapes';

/** 한 대의 기계: 물리 월드 + 캐비닛 + 집게 + 갠트리 + 경품들 */
export class Rig {
  readonly world: RAPIER.World;
  readonly geom: MachineGeometry;
  readonly cabinet: Cabinet;
  readonly claw: Claw;
  readonly gantry: Gantry;
  readonly home: THREE.Vector2;
  prizes: Prize[] = [];
  /** 대기 중인 집게 끝의 높이 (경품 바닥 기준) */
  readonly clawTipY: number;

  constructor(private scene: THREE.Object3D, readonly settings: MachineSettings) {
    this.world = createWorld();
    const base = GEOMETRY[settings.kind];
    // 천장 높이는 경품 크기로 정한다: 집게 끝이 경품 2.5개가 쌓인 높이쯤에 오게 (실제 기계처럼)
    const sc = base.width / 0.8;
    this.clawTipY = settings.ceilingScale * idleTipHeight(settings);
    // 천장(트롤리) ~ 집게 끝 = 줄 최소 길이 + 본체 높이 + 발 길이 (claw.ts 치수 기준)
    const clawStack = 0.13 * sc + 1.02 * base.prongLength * settings.prongScale;
    this.geom = { ...base, height: this.clawTipY + clawStack };
    this.cabinet = buildCabinet(this.world, scene, this.geom, settings);

    const g = this.geom;
    const L = g.prongLength * settings.prongScale;
    // 집게가 갈 수 있는 끝: 본체 반지름 + 발이 옆으로 벌어지는 만큼 벽에서 띄운다 (벽에 기대면 줄이 기울어짐)
    const margin = (0.05 * g.prongLength) / 0.13 + 0.35 * L;
    const min = { x: -g.width / 2 + margin, z: -g.depth / 2 + margin };
    const max = { x: g.width / 2 - margin, z: g.depth / 2 - margin };
    this.home = new THREE.Vector2(
      THREE.MathUtils.clamp(this.cabinet.chuteCenter.x, min.x, max.x),
      THREE.MathUtils.clamp(this.cabinet.chuteCenter.y, min.z, max.z),
    );
    this.claw = new Claw(this.world, scene, g, settings, this.home);
    this.gantry = new Gantry(this.home.x, this.home.y, min, max, g.moveAccel, g.moveSmooth);
    this.fillPrizes();
  }

  /** 경품을 진열하고, 가라앉을 때까지 미리 시뮬레이션 */
  fillPrizes() {
    for (const p of this.prizes) removePrize(this.world, this.scene, p);
    this.prizes = [];
    const g = this.geom, c = this.cabinet;
    const list: PrizeKind[] = [];
    for (const [kind, n] of Object.entries(this.settings.prizeMix) as [PrizeKind, number][]) {
      if (!PRIZES[kind].machines.includes(this.settings.kind)) continue;
      for (let i = 0; i < n; i++) list.push(kind);
    }
    // 실제 오락실처럼 바닥에 줄 맞춰 세워 진열하고, 남는 건 위에 얹는다
    shuffle(list);
    const maxR = Math.max(0.03, ...list.map((k) => PRIZES[k].size));
    const meanR = list.reduce((a, k) => a + PRIZES[k].size, 0) / Math.max(1, list.length);
    const cell = Math.max(0.05, meanR * 1.6);
    const guardPad = 0.02;
    const slots: THREE.Vector2[] = [];
    const inset = cell / 2 + maxR * 0.25; // 팔/귀가 벽 밖에 생기지 않도록 벽에서 띄운다
    const nx = Math.max(1, Math.floor((g.width - 2 * inset) / cell) + 1);
    const nz = Math.max(1, Math.floor((g.depth - 2 * inset) / cell) + 1);
    const sx = nx > 1 ? (g.width - 2 * inset) / (nx - 1) : 0;
    const sz = nz > 1 ? (g.depth - 2 * inset) / (nz - 1) : 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x = -g.width / 2 + inset + ix * sx;
        const z = -g.depth / 2 + inset + iz * sz;
        const inChute = x < c.chuteMax.x + cell * 0.5 + guardPad && z > c.chuteMin.y - cell * 0.5 - guardPad;
        if (!inChute) slots.push(new THREE.Vector2(x, z));
      }
    }
    shuffle(slots);
    list.forEach((kind, i) => {
      const slot = slots[i % slots.length];
      const layer = Math.floor(i / slots.length);
      const jitter = cell * 0.12;
      const x = slot.x + THREE.MathUtils.randFloatSpread(jitter);
      const z = slot.y + THREE.MathUtils.randFloatSpread(jitter);
      const y = 0.005 + layer * maxR * 2.2;
      // 대부분 똑바로 세우고, 위층이나 일부는 눕히거나 기울인다
      const tilt = layer > 0 || Math.random() < 0.25;
      const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        tilt ? THREE.MathUtils.randFloat(-1.5, 1.5) : THREE.MathUtils.randFloatSpread(0.15),
        Math.random() * Math.PI * 2,
        tilt ? THREE.MathUtils.randFloat(-0.6, 0.6) : THREE.MathUtils.randFloatSpread(0.15),
      ));
      this.prizes.push(spawnPrize(this.world, this.scene, kind, new THREE.Vector3(x, y, z), rot));
    });
    this.settle(3);
    // 배출구로 굴러 들어갔거나 벽에 끼인 건 제거
    const outside = (col: RAPIER.Collider) => {
      const t = col.translation();
      return Math.abs(t.x) > g.width / 2 || Math.abs(t.z) > g.depth / 2;
    };
    // 너무 높이 쌓여 대기 중인 집게에 닿을 만한 것도 뺀다
    const tooHigh = (p: Prize) => Math.max(...p.colliders.map((q) => q.translation().y)) + p.def.size * 0.5 > this.clawTipY - 0.015;
    for (const p of [...this.prizes]) {
      if (p.main.translation().y < c.successY || p.colliders.some(outside) || tooHigh(p)) this.removePrizeObj(p);
    }
    this.syncAll();
  }

  settle(seconds: number) {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
      this.claw.preStep();
      this.world.step();
    }
  }

  removePrizeObj(p: Prize) {
    removePrize(this.world, this.scene, p);
    this.prizes = this.prizes.filter((q) => q !== p);
  }

  get synced(): Synced[] {
    return [...this.claw.synced, ...this.prizes.flatMap((p) => p.synced)];
  }

  syncAll() {
    for (const s of this.synced) syncObject(s);
    this.claw.sync();
    this.syncGantryVisual(this.claw.trolley.translation());
  }

  syncGantryVisual(t: { x: number; z: number }) {
    this.cabinet.bridge.position.z = t.z;
    this.cabinet.carriage.position.x = t.x;
    this.cabinet.carriage.position.z = t.z;
  }

  dispose() {
    for (const p of this.prizes) for (const s of p.synced) this.scene.remove(s.obj);
    this.claw.dispose();
    this.scene.remove(this.cabinet.group);
    this.world.free();
  }
}

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/** 경품 구성에 맞춘 기본 집게 대기 높이: 쌓였을 때 한 개 두께(평균) × 2.5 */
function idleTipHeight(s: MachineSettings): number {
  const sc = GEOMETRY[s.kind].width / 0.8;
  let sum = 0, n = 0, biggest = 0;
  for (const [kind, count] of Object.entries(s.prizeMix) as [PrizeKind, number][]) {
    if (!count || !PRIZES[kind].machines.includes(s.kind)) continue;
    sum += PRIZES[kind].stack * count;
    n += count;
    biggest = Math.max(biggest, PRIZES[kind].stack);
  }
  const stack = n ? sum / n : 0.15 * sc;
  // 너무 납작한 경품만 있어도 이동 중 더미에 걸리지 않을 만큼은 띄우고,
  // 가드가 높은 기계는 집어 든 경품이 가드를 넘어갈 만큼 올라가야 한다
  return Math.max(2.5 * stack, 0.3 * sc, s.guardHeight + 0.9 * biggest);
}

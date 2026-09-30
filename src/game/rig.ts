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

  constructor(private scene: THREE.Scene, readonly settings: MachineSettings) {
    this.world = createWorld();
    this.geom = GEOMETRY[settings.kind];
    this.cabinet = buildCabinet(this.world, scene, this.geom, settings);

    const g = this.geom;
    const L = g.prongLength * settings.prongScale;
    const margin = (0.05 * g.prongLength) / 0.13 + 0.15 * L;
    const min = { x: -g.width / 2 + margin, z: -g.depth / 2 + margin };
    const max = { x: g.width / 2 - margin, z: g.depth / 2 - margin };
    this.home = new THREE.Vector2(
      THREE.MathUtils.clamp(this.cabinet.chuteCenter.x, min.x, max.x),
      THREE.MathUtils.clamp(this.cabinet.chuteCenter.y, min.z, max.z),
    );
    this.claw = new Claw(this.world, scene, g, settings, this.home);
    this.gantry = new Gantry(this.home.x, this.home.y, min, max, g.moveAccel);
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
      return Math.abs(t.x) > g.width / 2 || Math.abs(t.z) > g.depth / 2 || t.y > g.height * 0.6;
    };
    for (const p of [...this.prizes]) {
      if (p.main.translation().y < c.successY || p.colliders.some(outside)) this.removePrizeObj(p);
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

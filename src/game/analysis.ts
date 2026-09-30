import * as THREE from 'three';
import type { RAPIER, Synced } from '../physics/world';
import type { Prize } from '../prizes/ragdoll';
import { prizeCenterOfMass } from '../prizes/ragdoll';
import type { Claw } from '../machine/claw';
import type { Cabinet } from '../machine/cabinet';

export type Phase =
  | 'idle' | 'moveX' | 'moveZ' | 'move' | 'drop' | 'grab' | 'lift' | 'top' | 'return' | 'release' | 'result';

export const PHASE_LABEL: Record<Phase, string> = {
  idle: '동전을 넣으세요', moveX: '→ 버튼', moveZ: '↑ 버튼', move: '이동 후 집기',
  drop: '하강 중', grab: '집는 중', lift: '상승 중', top: '꼭대기', return: '배출구로 이동',
  release: '놓는 중', result: '결과',
};

export type Cause =
  | 'success' | 'pushSuccess' | 'miss' | 'slip' | 'dropLift' | 'dropTop' | 'dropSwing' | 'dropReturn' | 'dropChute' | 'guard' | 'dropRelease';

export const CAUSE_LABEL: Record<Cause, string> = {
  success: '집어서 성공', pushSuccess: '밀어서 성공', miss: '빈 곳 집음', slip: '닿았지만 미끄러짐',
  dropLift: '상승 중 낙하', dropTop: '꼭대기 힘 빠짐', dropSwing: '흔들림 낙하', dropReturn: '이동 중 낙하', dropChute: '배출구 앞 힘 빠짐',
  guard: '가드 걸림', dropRelease: '배출구 빗나감',
};

export interface AttemptResult {
  success: boolean;
  cause: Cause;
  title: string;
  detail: string;
  tips: string[];
  prizeName?: string;
  wonKinds: string[];
  strongTurn: boolean;
  trace: TracePoint[];
}

export interface TracePoint {
  t: number;
  power: number;  // 실제 발 토크 비율 (0~1)
  lift: number;   // 잡힌 경품이 원래 위치보다 올라간 높이 (m)
  swing: number;  // 줄 흔들림 각도 (deg)
  phase: Phase;
}

/** 받침 유무에 맞는 조사를 붙인다: josa('토끼', '이', '가') → '토끼가' */
function josa(word: string, withBatchim: string, without: string): string {
  const c = word.charCodeAt(word.length - 1);
  const hasBatchim = c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
  return word + (hasBatchim ? withBatchim : without);
}

/** 경품이 집게 충돌체와 실제로 닿아 있는지 */
export function touchingHandles(world: RAPIER.World, prize: Prize, handles: Set<number>): boolean {
  let hit = false;
  for (const c of prize.colliders) {
    world.contactPairsWith(c, (other) => {
      if (hit || !handles.has(other.handle)) return;
      world.contactPair(c, other, (m) => { if (m.numContacts() > 0) hit = true; });
    });
    if (hit) return true;
  }
  return false;
}

/** 한 판의 진행을 관찰해서 실패 원인을 판정 */
export class AttemptTracker {
  private startY = new Map<number, number>();
  private touched = new Set<number>();
  private grabOffset = new Map<number, number>();
  private heldId: number | null = null;
  private maxLift = 0;
  private lostFor = 0;
  private dropped: { id: number; phase: Phase; swing: number; zone: number } | null = null;
  private grabZone = 1;
  private wonIds: number[] = [];
  private heldAtRelease: number | null = null;
  private t = 0;
  trace: TracePoint[] = [];
  private liftThresh: number;

  constructor(
    private world: RAPIER.World,
    private prizes: Prize[],
    private claw: Claw,
    private cabinet: Cabinet,
    public strongTurn: boolean,
    /** 집게 위치별 힘 비율 (배출구 앞 힘 빠짐) */
    private zone: (x: number, z: number) => number = () => 1,
  ) {
    this.liftThresh = claw.L * 0.25;
    for (const p of prizes) this.startY.set(p.id, prizeCenterOfMass(p).y);
  }

  private prizeById(id: number) { return this.prizes.find((p) => p.id === id)!; }

  step(phase: Phase, dt: number) {
    this.t += dt;
    const active = this.prizes.filter((p) => !p.won);

    // 발에 닿은 경품 기록
    if (phase === 'grab' || phase === 'lift') {
      const hub = this.claw.hub.translation();
      if (phase === 'grab') this.grabZone = this.zone(hub.x, hub.z);
      for (const p of active) {
        if (touchingHandles(this.world, p, this.claw.fingerColliderHandles)) {
          if (!this.touched.has(p.id)) {
            const com = prizeCenterOfMass(p);
            this.grabOffset.set(p.id, Math.hypot(com.x - hub.x, com.z - hub.z));
          }
          this.touched.add(p.id);
        }
      }
    }

    // 잡혀 올라가는 경품 추적
    const carrying = phase === 'lift' || phase === 'top' || phase === 'return';
    if (carrying && !this.dropped) {
      if (this.heldId === null) {
        let best: Prize | null = null, bestLift = this.liftThresh;
        for (const p of active) {
          const lift = prizeCenterOfMass(p).y - this.startY.get(p.id)!;
          if (lift > bestLift && touchingHandles(this.world, p, this.claw.colliderHandles)) {
            best = p; bestLift = lift;
          }
        }
        if (best) this.heldId = best.id;
      } else {
        const p = this.prizeById(this.heldId);
        const lift = prizeCenterOfMass(p).y - this.startY.get(p.id)!;
        this.maxLift = Math.max(this.maxLift, lift);
        if (touchingHandles(this.world, p, this.claw.colliderHandles)) this.lostFor = 0;
        else this.lostFor += dt;
        if (this.lostFor > 0.15) {
          const tt = this.claw.trolley.translation();
          this.dropped = { id: p.id, phase, swing: THREE.MathUtils.radToDeg(this.claw.swingAngle()), zone: this.zone(tt.x, tt.z) };
        }
      }
    }
    if (phase === 'release' && this.heldAtRelease === null && this.heldId !== null && !this.dropped) {
      this.heldAtRelease = this.heldId;
    }

    // 성공 판정
    for (const p of active) {
      if (prizeCenterOfMass(p).y < this.cabinet.successY) {
        p.won = true;
        this.wonIds.push(p.id);
      }
    }

    // 그래프용 기록 (30Hz)
    if (this.trace.length === 0 || this.t - this.trace[this.trace.length - 1].t >= 1 / 30) {
      let lift = 0;
      if (this.heldId !== null) {
        const p = this.prizeById(this.heldId);
        lift = Math.max(0, prizeCenterOfMass(p).y - this.startY.get(p.id)!);
      }
      this.trace.push({
        t: this.t,
        power: this.claw.closing ? this.claw.appliedRatio : 0,
        lift,
        swing: THREE.MathUtils.radToDeg(this.claw.swingAngle()),
        phase,
      });
    }
  }

  finish(): AttemptResult {
    const base = { strongTurn: this.strongTurn, trace: this.trace };
    const wonKinds = this.wonIds.map((id) => this.prizeById(id).def.name);
    const cm = (m: number) => `${(m * 100).toFixed(1)}cm`;

    if (this.wonIds.length > 0) {
      const heldWon = this.heldId !== null && this.wonIds.includes(this.heldId);
      const name = wonKinds.join(', ');
      return {
        ...base, success: true, wonKinds, prizeName: name,
        cause: heldWon ? 'success' : 'pushSuccess',
        title: `성공! ${name}`,
        detail: heldWon
          ? '집어서 배출구까지 옮겼어요.'
          : '집은 건 아니지만 밀리거나 굴러서 배출구로 들어갔어요. 실전에서도 자주 쓰는 "밀기" 기술이에요.',
        tips: this.strongTurn ? ['이번 판은 강집게 차례였어요. 실제 기계라면 운도 따라준 거예요.'] : [],
      };
    }

    const strongNote = this.strongTurn
      ? ['이번 판은 강집게 차례였는데 놓쳤어요. 강집게 판은 위치만 맞으면 거의 성공해요.']
      : [];

    if (this.heldId === null) {
      if (this.touched.size === 0) {
        return {
          ...base, success: false, wonKinds, cause: 'miss',
          title: '빈 곳을 집었어요',
          detail: '집게 발이 경품에 닿지 않았어요.',
          tips: [
            '앞뒤 거리는 앞에서 보면 헷갈려요. 시점 전환(V)으로 옆에서 보고 위치를 맞추세요.',
            '집게는 하강하면서 벌어지니까, 경품 중심이 집게 한가운데 오도록 맞추세요.',
            ...strongNote,
          ],
        };
      }
      const [id, off] = [...this.grabOffset.entries()].sort((a, b) => a[1] - b[1])[0] ?? [null, 0];
      const p = id !== null ? this.prizeById(id) : null;
      return {
        ...base, success: false, wonKinds, cause: 'slip',
        title: '닿았지만 들지 못했어요',
        prizeName: p?.def.name,
        detail: p
          ? `${p.def.name}에 닿았지만 발이 감기지 않고 미끄러졌어요. 집게 중심이 무게중심에서 ${cm(off)} 벗어나 있었어요.`
          : '경품에 닿았지만 미끄러졌어요.',
        tips: [
          ...(this.grabZone < 0.9 && !this.strongTurn
            ? [`배출구 가까이라 집는 힘이 평소의 ${Math.round(this.grabZone * 100)}%로 약해져 있었어요. 이 기계는 배출구 앞 경품을 일부러 잘 못 잡게 해 둔 거예요.`]
            : []),
          ...(p ? [p.def.tip] : []),
          '집는 힘이 약한 기계는 발 3개가 모두 경품 아래로 들어가야 해요.',
          ...strongNote,
        ],
      };
    }

    const held = this.prizeById(this.heldId);
    const name = held.def.name;
    if (this.dropped) {
      const d = this.dropped;
      if (d.phase === 'lift') {
        return {
          ...base, success: false, wonKinds, cause: 'dropLift', prizeName: name,
          title: '올라가다가 떨어졌어요',
          detail: `${josa(name, '을', '를')} ${cm(this.maxLift)} 들어 올렸지만 상승 중 힘이 버티지 못했어요.`,
          tips: [
            '상승 힘이 무게를 못 버티는 세팅이에요. 이런 기계는 정면으로 집어 올리기보다 걸기·굴리기가 현실적이에요.',
            held.def.tip, ...strongNote,
          ],
        };
      }
      if (d.phase === 'top') {
        return {
          ...base, success: false, wonKinds, cause: 'dropTop', prizeName: name,
          title: '꼭대기에서 힘이 빠졌어요',
          detail: `꼭대기에 도착하는 순간 집게 힘이 약해져서 ${josa(name, '이', '가')} 빠졌어요. 오락실 기계에서 가장 흔한 세팅이에요.`,
          tips: [
            '배출구 가까이 있는 경품을 노리세요. 떨어지더라도 배출구 쪽으로 튕기거나 굴러가요.',
            '꼭대기 힘이 약한 기계는 몇 판에 한 번 강집게가 나와요. 다른 사람이 얼마나 했는지 보는 것도 방법이에요.',
            ...strongNote,
          ],
        };
      }
      // return
      if (d.zone < 0.9 && !this.strongTurn) {
        return {
          ...base, success: false, wonKinds, cause: 'dropChute', prizeName: name,
          title: '배출구 앞에서 힘이 빠졌어요',
          detail: `배출구에 가까워지자 집게 힘이 평소의 ${Math.round(d.zone * 100)}%로 약해져서 ${josa(name, '이', '가')} 빠졌어요.`,
          tips: [
            '오락실 기계에 흔한 세팅이에요. 멀리 있는 건 잘 잡히지만 배출구 앞에서 힘이 빠져요.',
            '떨어진 경품이 배출구 쪽으로 굴러가도록, 배출구를 향해 기울어진 경품이나 가드에 기댄 경품을 노리세요.',
            '배출구 앞에 떨어져 가드에 걸친 경품은 다음 판에 살짝 밀기만 해도 들어가요.',
          ],
        };
      }
      if (d.swing > 5) {
        return {
          ...base, success: false, wonKinds, cause: 'dropSwing', prizeName: name,
          title: '흔들려서 떨어졌어요',
          detail: `배출구로 가는 중 집게가 ${d.swing.toFixed(0)}° 흔들리면서 ${josa(name, '이', '가')} 빠졌어요.`,
          tips: [
            '이동 중 흔들림은 갠트리가 멈추고 출발할 때 커져요. 배출구와 앞뒤·좌우가 가까운 경품일수록 덜 흔들려요.',
            ...strongNote,
          ],
        };
      }
      return {
        ...base, success: false, wonKinds, cause: 'dropReturn', prizeName: name,
        title: '이동 중에 떨어졌어요',
        detail: `배출구로 옮기는 동안 힘이 부족해서 ${josa(name, '이', '가')} 빠졌어요.`,
        tips: [
          '이동 힘이 약한 기계예요. 배출구에 가까운 경품일수록 도착 전에 빠질 시간이 짧아요.',
          ...strongNote,
        ],
      };
    }

    // 배출구 위까지 옮겼는데 성공이 아님
    const com = prizeCenterOfMass(held);
    const c = this.cabinet;
    const nearChute = com.x < c.chuteMax.x + 0.05 && com.z > c.chuteMin.y - 0.05;
    if (nearChute) {
      return {
        ...base, success: false, wonKinds, cause: 'guard', prizeName: name,
        title: '배출구 가드에 걸렸어요',
        detail: `${josa(name, '을', '를')} 배출구 위까지 옮겼지만 가드에 걸쳐서 안 떨어졌어요.`,
        tips: ['다음 판에 가드에 걸린 경품을 살짝 밀기만 해도 들어갈 수 있어요.', '크거나 긴 경품은 가드에 잘 걸려요.'],
      };
    }
    return {
      ...base, success: false, wonKinds, cause: 'dropRelease', prizeName: name,
      title: '아깝게 실패했어요',
      detail: `${josa(name, '을', '를')} 옮겼지만 배출구에 들어가지 않았어요.`,
      tips: [held.def.tip],
    };
  }
}

/** 리플레이 녹화: 강체들의 위치/회전을 60Hz로 저장 */
export class Recorder {
  frames: Float32Array[] = [];
  phases: Phase[] = [];
  private objs: Synced[] = [];
  private counter = 0;

  begin(objs: Synced[]) {
    this.objs = objs;
    this.frames = [];
    this.phases = [];
    this.counter = 0;
  }

  record(trolley: RAPIER.RigidBody, phase: Phase) {
    if (this.counter++ % 2 !== 0) return;
    const f = new Float32Array(this.objs.length * 7 + 3);
    this.objs.forEach((s, i) => {
      const t = s.body.translation(), r = s.body.rotation();
      f.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7);
    });
    const tt = trolley.translation();
    f.set([tt.x, tt.y, tt.z], this.objs.length * 7);
    this.frames.push(f);
    this.phases.push(phase);
  }

  /** frame 인덱스의 자세를 화면 오브젝트에 적용하고 트롤리 위치를 반환 */
  apply(index: number): THREE.Vector3 {
    const f = this.frames[Math.max(0, Math.min(this.frames.length - 1, index))];
    this.objs.forEach((s, i) => {
      const o = i * 7;
      s.obj.position.set(f[o], f[o + 1], f[o + 2]);
      s.obj.quaternion.set(f[o + 3], f[o + 4], f[o + 5], f[o + 6]);
    });
    const n = this.objs.length * 7;
    return new THREE.Vector3(f[n], f[n + 1], f[n + 2]);
  }

  get length() { return this.frames.length; }
}

import { DT } from '../physics/world';
import type { Rig } from './rig';
import { drawPayoutTarget } from '../machine/settings';
import { AttemptTracker, Recorder, type AttemptResult, type Phase } from './analysis';

/** 레버 방향을 한 번 꺾을 때 집게가 도는 각도 */
const TWIST_PER_TURN = (3 * Math.PI) / 180;

export interface Input {
  right: boolean;
  up: boolean;
  left: boolean;
  down: boolean;
  drop: boolean;
}

export interface PayoutState {
  playsSinceWin: number;
  spentSinceWin: number;
  /** 이번 주기에 강집게가 나올 판 수·금액 (주기 시작 때 무작위로 정함) */
  target?: { plays: number; amount: number };
}

/** 한 판의 진행: 대기 → 이동 → 하강 → 집기 → 상승 → 꼭대기 → 복귀 → 개방 → 결과 */
export class Controller {
  phase: Phase = 'idle';
  phaseTime = 0;
  timeLeft = 0;
  strongTurn = false;
  private pressedOnce = false;
  private dropStart = 0;
  private slackTime = 0;
  private lastDir = { x: 0, z: 0 };
  tracker: AttemptTracker | null = null;
  readonly recorder = new Recorder();
  onResult: (r: AttemptResult) => void = () => {};

  constructor(private rig: Rig, private payout: PayoutState) {
    this.idleClaw();
  }

  private get s() { return this.rig.settings; }

  private idleClaw() {
    this.rig.claw.closing = true;
    this.rig.claw.power = 0.25;
  }

  private go(p: Phase) {
    this.phase = p;
    this.phaseTime = 0;
    this.pressedOnce = false;
  }

  get busy() { return this.phase !== 'idle' && this.phase !== 'result'; }

  /** 동전 투입. 이번 판이 강집게 차례인지 결정 */
  start() {
    if (this.busy) return false;
    // 지난 판에 뽑힌 경품 정리
    for (const p of this.rig.prizes.filter((q) => q.won)) this.rig.removePrizeObj(p);
    const s = this.s;
    const pay = this.payout;
    // 이번 주기에 강집게가 나올 판(금액)은 주기가 시작될 때 기준값 근처에서 무작위로 정해진다
    if (!pay.target) pay.target = drawPayoutTarget(s);
    pay.playsSinceWin++;
    pay.spentSinceWin += s.price;
    this.strongTurn =
      (s.payoutMode === 'everyN' && pay.playsSinceWin >= pay.target.plays) ||
      (s.payoutMode === 'amount' && pay.spentSinceWin >= pay.target.amount);
    this.tracker = new AttemptTracker(this.rig.world, this.rig.prizes, this.rig.claw, this.rig.cabinet, this.strongTurn,
      (x, z) => this.zoneFactor(x, z));
    this.recorder.begin(this.rig.synced);
    this.timeLeft = s.timeLimit;
    this.lastDir = { x: 0, z: 0 };
    this.go(s.controlMode === 'twoButton' ? 'moveX' : 'move');
    return true;
  }

  /** 배출구 앞 힘 빠짐: 집게 위치 (x, z)에서 평소 힘에 곱할 비율 (배출구 위 nearChutePower% → 멀어지면 100%) */
  zoneFactor(x: number, z: number): number {
    const s = this.s;
    if (s.nearChuteRange <= 0) return 1;
    const c = this.rig.cabinet;
    const dx = Math.max(c.chuteMin.x - x, 0, x - c.chuteMax.x);
    const dz = Math.max(c.chuteMin.y - z, 0, z - c.chuteMax.y);
    const t = Math.min(1, Math.hypot(dx, dz) / s.nearChuteRange);
    const near = s.nearChutePower / 100;
    return near + (1 - near) * t * t * (3 - 2 * t);
  }

  /** 구간별 집게 힘 (0~1). 배출구에 가까우면 약해진다. 강집게 판은 모든 구간이 강집게 힘 이상. */
  powerFor(p: 'grab' | 'lift' | 'top' | 'return'): number {
    const s = this.s;
    const base = { grab: s.grabPower, lift: s.liftPower, top: s.topPower, return: s.returnPower }[p];
    const v = base * this.zoneFactor(this.rig.gantry.x, this.rig.gantry.z);
    return (this.strongTurn ? Math.max(v, s.strongPower) : v) / 100;
  }

  /** 물리 스텝마다 호출 */
  update(input: Input) {
    const dt = DT;
    const { claw, gantry } = this.rig;
    const s = this.s;
    this.phaseTime += dt;

    const timed = this.phase === 'moveX' || this.phase === 'moveZ' || this.phase === 'move';
    if (timed) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.go('drop'); }
    }

    switch (this.phase) {
      case 'idle':
      case 'result':
        gantry.drive(0, 0, s.moveSpeed, dt);
        break;
      case 'moveX': {
        gantry.drive(input.right ? 1 : 0, 0, s.moveSpeed, dt);
        if (input.right) this.pressedOnce = true;
        else if (this.pressedOnce) this.go('moveZ');
        break;
      }
      case 'moveZ': {
        gantry.drive(0, input.up ? -1 : 0, s.moveSpeed, dt);
        if (input.up) this.pressedOnce = true;
        else if (this.pressedOnce) this.go('drop');
        break;
      }
      case 'move': {
        const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const dz = (input.down ? 1 : 0) - (input.up ? 1 : 0);
        gantry.drive(dx, dz, s.moveSpeed, dt);
        // 레버를 한쪽으로 돌리듯 방향을 꺾으면 집게가 그쪽으로 조금 돈다 (앞뒤로만 흔들면 안 돎)
        if (dx || dz) {
          const cross = this.lastDir.x * dz - this.lastDir.z * dx;
          if (cross) claw.twist(-Math.sign(cross) * TWIST_PER_TURN);
          this.lastDir = { x: dx, z: dz };
        }
        if (input.drop) this.go('drop');
        break;
      }
      case 'drop': {
        gantry.drive(0, 0, s.moveSpeed, dt);
        if (this.phaseTime <= dt * 1.5) {
          claw.closing = false;
          this.dropStart = claw.length;
          this.slackTime = 0;
        }
        const lMax = claw.lMin + s.dropDepth * (claw.lMaxAbs - claw.lMin);
        claw.setLength(Math.min(lMax, claw.length + s.dropSpeed * dt));
        // 줄 늘어짐 감지: 잠깐(0.12초) 계속될 때만 멈춘다. 그 사이 집게가 자기 무게로 경품 사이에 파고든다.
        const slackTol = claw.L * 0.15;
        const slack = claw.length - claw.actualLength();
        this.slackTime = slack > slackTol && claw.length > this.dropStart + 0.02 ? this.slackTime + dt : 0;
        const reachedBottom = claw.length >= lMax - 1e-4 && slack < slackTol;
        if ((this.phaseTime > 0.25 && this.slackTime > 0.12) || (reachedBottom && this.phaseTime > 0.3)) {
          // 줄이 늘어짐(무언가 위에 얹힘) 또는 최대 깊이 → 멈추고 집기
          // 실제 기계처럼 줄에 약간 여유를 남겨, 발이 오므라드는 동안 집게가 자기 무게로 파고들게 한다
          claw.setLength(Math.min(lMax, claw.actualLength() + claw.L * 0.4));
          this.go('grab');
        }
        break;
      }
      case 'grab':
        claw.closing = true;
        claw.power = this.powerFor('grab');
        if (this.phaseTime >= s.grabTime) this.go('lift');
        break;
      case 'lift':
        claw.power = this.powerFor('lift');
        // 윈치는 서서히 가속한다 (줄이 팽팽해지는 순간의 충격 완화)
        claw.setLength(claw.length - s.liftSpeed * Math.min(1, this.phaseTime / 0.4) * dt);
        if (claw.length <= claw.lMin + 1e-4 && claw.actualLength() < claw.lMin + claw.L * 0.1) this.go('top');
        break;
      case 'top':
        claw.power = this.powerFor('top');
        if (this.phaseTime >= s.topPause) this.go('return');
        break;
      case 'return': {
        claw.power = this.powerFor('return');
        const home = this.rig.home;
        const arrived = gantry.moveTo(home.x, home.y, s.moveSpeed, dt);
        if (arrived && this.phaseTime > 0.1) this.go('release');
        break;
      }
      case 'release':
        claw.closing = false;
        if (this.phaseTime >= 2.2) this.finish();
        break;
    }

    claw.setTrolley(gantry.x, gantry.z);
    if (this.busy) {
      this.tracker?.step(this.phase, dt);
      this.recorder.record(claw.trolley, this.phase);
    }
  }

  private finish() {
    this.idleClaw();
    const r = this.tracker!.finish();
    // 뽑았거나 강집게 판이 지나가면 새 주기 (다음 강집게 판을 다시 무작위로)
    if (r.success || this.strongTurn) {
      this.payout.playsSinceWin = 0;
      this.payout.spentSinceWin = 0;
      this.payout.target = undefined;
    }
    this.go('result');
    this.onResult(r);
  }
}

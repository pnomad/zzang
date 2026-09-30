import GUI from 'lil-gui';
import { PRESETS, type MachineSettings, type PrizeKind } from '../machine/settings';
import { PRIZES } from '../prizes/shapes';

export interface PanelState {
  real: boolean;
  presetIndex: number;
  showCom: boolean;
}

export interface PanelHandlers {
  preset(index: number): void;
  rebuild(): void;
  refill(): void;
  mode(real: boolean): void;
  reveal(): void;
  live(): void;          // 즉시 반영되는 값 변경
  resetStats(): void;
}

/** 오른쪽 세팅 패널. 기계 종류가 바뀌면 경품 목록이 달라지므로 통째로 다시 그린다. */
export class Panel {
  private gui: GUI | null = null;

  constructor(private s: MachineSettings, private state: PanelState, private h: PanelHandlers) {
    this.render();
  }

  setSettings(s: MachineSettings) {
    this.s = s;
    this.render();
  }

  render() {
    // 좁은 화면(휴대폰)에서는 처음에 접어 둔다
    const closed = this.gui ? this.gui._closed : window.innerWidth < 720;
    this.gui?.destroy();
    const gui = (this.gui = new GUI({ title: '기계 세팅' }));
    if (closed) gui.close();
    const s = this.s, h = this.h, st = this.state;

    const modeObj = { mode: st.real ? '실전' : '연습' };
    gui.add(modeObj, 'mode', ['연습', '실전']).name('모드').onChange((v: string) => h.mode(v === '실전'));

    const presetMap: Record<string, number> = {};
    PRESETS.forEach((p, i) => (presetMap[p.name] = i));
    gui.add(st, 'presetIndex', presetMap).name('기계 프리셋').onChange((i: number) => h.preset(i));

    const play = gui.addFolder('게임');
    play.add(s, 'controlMode', { '한국식 2버튼 (→ ↑)': 'twoButton', '조이스틱 + 집기': 'joystick' })
      .name('조작 방식').onChange(h.live);
    play.add(s, 'price', 100, 5000, 100).name('1회 가격 (원)').onChange(h.live);
    play.add(s, 'timeLimit', 5, 60, 1).name('제한 시간 (초)').onChange(h.live);
    play.add({ reset: h.resetStats }, 'reset').name('기록 초기화');

    if (st.real) {
      const real = gui.addFolder('실전 모드');
      real.add({ info: '세팅은 숨겨져 있어요' }, 'info').name('안내').disable();
      real.add({ reveal: h.reveal }, 'reveal').name('🔍 이 기계 세팅 공개');
      real.add({ again: () => h.mode(true) }, 'again').name('🎲 다른 기계로 바꾸기');
      this.prizeFolder(gui, true);
      return;
    }

    const power = gui.addFolder('집게 힘 (구간별 전압)');
    power.add(s, 'grabPower', 0, 100, 1).name('집을 때 %');
    power.add(s, 'liftPower', 0, 100, 1).name('올라갈 때 %');
    power.add(s, 'topPower', 0, 100, 1).name('꼭대기에서 %');
    power.add(s, 'returnPower', 0, 100, 1).name('배출구 이동 중 %');

    const payout = gui.addFolder('확률 (페이아웃)');
    payout.add(s, 'payoutMode', { '없음': 'none', 'N판마다 강집게': 'everyN', '누적 금액마다 강집게': 'amount' }).name('방식');
    payout.add(s, 'payoutN', 2, 40, 1).name('N판');
    payout.add(s, 'payoutAmount', 1000, 100000, 1000).name('누적 금액 (원)');
    payout.add(s, 'strongPower', 0, 100, 1).name('강집게 힘 %');

    const motion = gui.addFolder('움직임');
    motion.add(s, 'moveSpeed', 0.05, 0.5, 0.01).name('이동 속도 (m/s)');
    motion.add(s, 'dropSpeed', 0.05, 0.8, 0.01).name('하강 속도 (m/s)');
    motion.add(s, 'liftSpeed', 0.05, 0.8, 0.01).name('상승 속도 (m/s)');
    motion.add(s, 'dropDepth', 0.3, 1, 0.01).name('하강 깊이 비율');
    motion.add(s, 'grabTime', 0.2, 2, 0.05).name('집는 시간 (초)');
    motion.add(s, 'topPause', 0, 2, 0.05).name('꼭대기 대기 (초)');
    motion.add(s, 'swingDamping', 0, 5, 0.1).name('흔들림 감쇠').onChange(h.live);
    motion.close();

    const struct = gui.addFolder('구조 (적용 버튼 필요)');
    const gMax = s.kind === 'regular' ? 0.2 : 0.1;
    struct.add(s, 'guardHeight', 0, gMax, 0.005).name('배출구 가드 높이 (m)');
    struct.add(s, 'prongScale', 0.7, 1.4, 0.01).name('집게 발 길이 배율');
    struct.add(s, 'openAngleDeg', 20, 55, 1).name('벌어짐 각도 (°)');
    struct.add({ apply: h.rebuild }, 'apply').name('✅ 적용 (기계 다시 만들기)');
    struct.close();

    this.prizeFolder(gui, false);

    const view = gui.addFolder('보기');
    view.add(st, 'showCom').name('무게중심 표시');
  }

  private prizeFolder(gui: GUI, locked: boolean) {
    const s = this.s, h = this.h;
    const f = gui.addFolder('경품 구성');
    for (const kind of Object.keys(PRIZES) as PrizeKind[]) {
      const def = PRIZES[kind];
      if (!def.machines.includes(s.kind)) continue;
      if (s.prizeMix[kind] === undefined) s.prizeMix[kind] = 0;
      const c = f.add(s.prizeMix, kind, 0, 12, 1).name(def.name);
      if (locked) c.disable();
    }
    f.add({ refill: h.refill }, 'refill').name('🔄 경품 다시 채우기');
    f.close();
  }
}

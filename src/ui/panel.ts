import GUI from 'lil-gui';
import { PRESETS, type MachineSettings, type PrizeKind } from '../machine/settings';

import { PRIZES } from '../prizes/shapes';

export interface PanelState {
  real: boolean;
  presetIndex: number;
  showCom: boolean;
  showAim: boolean;
  showZone: boolean;
}

export interface PanelHandlers {
  rebuild(): void;
  refill(): void;
  mode(real: boolean): void;
  reveal(): void;
  live(): void;          // 즉시 반영되는 값 변경
  resetStats(): void;
  changed(): void;       // 아무 값이나 바뀜 (저장용)
  resetSettings(): void; // 프리셋 기본값으로 되돌리기
}

/** 오른쪽 세팅 패널. 기계 종류가 바뀌면 경품 목록이 달라지므로 통째로 다시 그린다. */
export class Panel {
  private gui: GUI | null = null;
  private visible = true;

  constructor(private s: MachineSettings, private state: PanelState, private h: PanelHandlers) {
    this.render();
  }

  setSettings(s: MachineSettings) {
    this.s = s;
    this.render();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.gui?.show(v);
  }

  render() {
    // 좁은 화면(휴대폰)에서는 처음에 접어 둔다
    const closed = this.gui ? this.gui._closed : window.innerWidth < 720;
    this.gui?.destroy();
    const gui = (this.gui = new GUI({ title: '기계 세팅' }));
    if (closed) gui.close();
    gui.show(this.visible);
    gui.onFinishChange(() => this.h.changed());
    const s = this.s, h = this.h, st = this.state;

    const modeObj = { mode: st.real ? '실전' : '연습' };
    gui.add(modeObj, 'mode', ['연습', '실전']).name('모드').onChange((v: string) => h.mode(v === '실전'));

    // 기계는 오락실에서 걸어가서 고른다. 여기서는 지금 기계 이름만 보여 준다
    gui.add({ machine: PRESETS[st.presetIndex].name }, 'machine').name('기계').disable();

    const play = gui.addFolder('게임');
    play.add(s, 'controlMode', { '자유 이동 + 집기': 'joystick', '한국식 2버튼 (→ ↑)': 'twoButton' })
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
    power.add(s, 'nearChuteRange', 0, s.kind === 'regular' ? 0.5 : 0.25, 0.01).name('배출구 앞 약해지는 거리 (m)').onChange(h.live);
    power.add(s, 'nearChutePower', 0, 100, 1).name('배출구 바로 위 힘 (평소의 %)').onChange(h.live);

    const payout = gui.addFolder('확률 (페이아웃)');
    payout.add(s, 'payoutMode', { '없음': 'none', '약 N판마다 강집게': 'everyN', '누적 금액마다 강집게': 'amount' }).name('방식');
    payout.add(s, 'payoutN', 2, 60, 1).name('N판 (평균)');
    payout.add(s, 'payoutSpread', 0, 60, 1).name('주기 편차 ±%');
    payout.add(s, 'payoutAmount', 1000, 100000, 1000).name('누적 금액 (원)');
    payout.add(s, 'strongPower', 0, 100, 1).name('강집게 힘 %');

    const motion = gui.addFolder('움직임');
    motion.add(s, 'moveSpeed', 0.05, 0.5, 0.01).name('이동 속도 (m/s)');
    motion.add(s, 'dropSpeed', 0.05, 0.8, 0.01).name('하강 속도 (m/s)');
    motion.add(s, 'liftSpeed', 0.05, 0.8, 0.01).name('상승 속도 (m/s)');
    motion.add(s, 'dropDepth', 0.3, 1, 0.01).name('하강 깊이 비율');
    motion.add(s, 'grabTime', 0.2, 2, 0.05).name('집는 시간 (초)');
    motion.add(s, 'topPause', 0, 2, 0.05).name('꼭대기 대기 (초)');
    motion.add(s, 'swingDamping', 0, 12, 0.1).name('흔들림 감쇠').onChange(h.live);
    motion.close();

    const struct = gui.addFolder('구조 (적용 버튼 필요)');
    const gMax = s.kind === 'regular' ? 0.4 : 0.15;
    struct.add(s, 'guardHeight', 0, gMax, 0.005).name('배출구 가드 높이 (m)');
    struct.add(s, 'ceilingScale', 0.6, 2, 0.05).name('집게 대기 높이 (경품 2.5개 = 1)');
    struct.add(s, 'prongScale', 0.7, 1.4, 0.01).name('집게 발 길이 배율');
    struct.add(s, 'openAngleDeg', 20, 55, 1).name('벌어짐 각도 (°)');
    struct.add({ apply: h.rebuild }, 'apply').name('✅ 적용 (기계 다시 만들기)');
    struct.close();

    this.prizeFolder(gui, false);

    const view = gui.addFolder('보기 (연습 도우미)');
    view.add(st, 'showAim').name('집게 착지 범위 표시');
    view.add(st, 'showZone').name('배출구 앞 약한 구역 표시');
    view.add(st, 'showCom').name('무게중심 표시');

    // 실수로 누르지 않도록 3초 안에 한 번 더 눌러야 되돌린다 (브라우저 확인창을 못 쓰는 환경도 있음)
    const RESET_LABEL = '↩ 이 프리셋 기본값으로';
    let armed = 0;
    const reset = gui.add({
      reset: () => {
        if (Date.now() - armed < 3000) { armed = 0; h.resetSettings(); return; }
        armed = Date.now();
        reset.name('한 번 더 누르면 되돌려요');
        setTimeout(() => { if (Date.now() - armed >= 3000) reset.name(RESET_LABEL); }, 3000);
      },
    }, 'reset').name(RESET_LABEL);
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

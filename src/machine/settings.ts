// 기계 세팅 모델. 실제 오락실 기계의 "전압/힘 세팅"과 확률(페이아웃) 세팅을 흉내낸다.

export type MachineKind = 'regular' | 'mini';
export type PayoutMode = 'none' | 'everyN' | 'amount';
export type ControlMode = 'twoButton' | 'joystick';

export type PrizeKind =
  | 'bear' | 'rabbit' | 'cushion' | 'longCat' | 'bigBear'
  | 'figureBox' | 'snackBox' | 'keyring'
  | 'miniDoll' | 'miniBear' | 'miniBigBear' | 'miniRabbit' | 'miniCat'
  | 'ribbonCat' | 'pinkHoodRabbit' | 'blackHoodRabbit' | 'cloudPuppy' | 'beretPuppy'
  | 'miniRibbonCat' | 'miniPinkHoodRabbit' | 'miniBlackHoodRabbit' | 'miniCloudPuppy' | 'miniBeretPuppy'
  | 'siliconeKeyring' | 'smallBox' | 'capsule';

/** 기계 크기별 고정 치수 (m). 세팅 패널에서 바꾸지 않는 값. */
export interface MachineGeometry {
  width: number;       // 경품 바닥 가로
  depth: number;       // 경품 바닥 세로
  height: number;      // 바닥 ~ 천장(갠트리) 높이
  chuteSize: number;   // 배출구 한 변
  prongLength: number; // 집게 발 기본 길이
  fullTorque: number;  // 집게 힘 100%일 때 발 하나의 토크 (N·m)
  hubMass: number;
  fingerMass: number;
  moveAccel: number;   // 갠트리 가감속 (m/s²)
  moveSmooth: number;  // 가속도를 올리고 내리는 시간 (s). 0이면 급출발·급정지
  clawStyle: 'block' | 'wire'; // 집게 발 모양: 굵은 판 / 가는 철사가 휜 모양 (미니 기계)
  swingStiff: number;  // 집게를 수직으로 되돌리는 힘 (중력의 몇 배). 0이면 그냥 매달린 진자 (잘 흔들림)
}

export const GEOMETRY: Record<MachineKind, MachineGeometry> = {
  regular: {
    width: 0.8, depth: 0.7, height: 0.95, chuteSize: 0.24,
    prongLength: 0.13, fullTorque: 0.8, hubMass: 0.6, fingerMass: 0.03, moveAccel: 1.0, moveSmooth: 0, swingStiff: 0, clawStyle: 'block',
  },
  mini: {
    // 실제 미니 기계 사진 기준: 12~15cm 키링 인형이 빽빽하고, 배출구는 인형 하나가 들어갈 만큼, 집게 발은 가늘고 길다
    width: 0.46, depth: 0.42, height: 0.5, chuteSize: 0.16,
    prongLength: 0.08, fullTorque: 0.09, hubMass: 0.14, fingerMass: 0.006, moveAccel: 0.8, moveSmooth: 0, swingStiff: 10, clawStyle: 'wire',
  },
};

export interface MachineSettings {
  kind: MachineKind;
  // 구조 (바꾸면 재배치 필요)
  guardHeight: number;     // 배출구 가드 높이 (m)
  ceilingScale: number;    // 집게 대기 높이 배율. 1이면 집게 끝이 경품 2.5개 쌓인 높이. 낮을수록 더미에 가깝다
  prongScale: number;      // 집게 발 길이 배율
  openAngleDeg: number;    // 집게 벌어짐 각도
  // 구간별 집게 힘 (%)
  grabPower: number;
  liftPower: number;
  topPower: number;
  returnPower: number;
  // 배출구 앞 힘 빠짐: 집게가 배출구에 가까울수록 힘이 약해진다 (멀리 있는 건 잘 잡고 배출구 앞에서는 놓치게)
  nearChuteRange: number;  // 배출구 가장자리에서 이 거리(m) 안쪽부터 약해짐. 0이면 없음
  nearChutePower: number;  // 배출구 바로 위에서의 힘 (평소 힘의 %)
  // 확률(페이아웃)
  payoutMode: PayoutMode;
  payoutN: number;         // 대략 N번째 판마다 강집게
  payoutSpread: number;    // 강집게 주기(판 수·금액)의 무작위 편차 (±%). 0이면 정확히 N판마다
  payoutAmount: number;    // 누적 금액(원) 넘으면 강집게
  strongPower: number;     // 강집게 판의 힘 (%)
  // 움직임
  moveSpeed: number;       // m/s
  dropSpeed: number;       // m/s
  liftSpeed: number;       // m/s
  dropDepth: number;       // 0~1, 최대 하강 깊이 비율
  grabTime: number;        // 바닥에서 집는 시간 (s)
  topPause: number;        // 꼭대기에서 멈추는 시간 (s)
  swingDamping: number;    // 줄 흔들림 감쇠 (클수록 덜 흔들림)
  // 게임
  timeLimit: number;       // s
  price: number;           // 1회 가격 (원)
  controlMode: ControlMode;
  prizeMix: Partial<Record<PrizeKind, number>>;
}

const REGULAR_BASE: MachineSettings = {
  kind: 'regular',
  guardHeight: 0.08,
  ceilingScale: 1,
  prongScale: 1,
  openAngleDeg: 38,
  grabPower: 85,
  liftPower: 45,
  topPower: 22,
  returnPower: 18,
  nearChuteRange: 0.2,
  nearChutePower: 55,
  payoutMode: 'everyN',
  payoutN: 20,
  payoutSpread: 0,
  payoutAmount: 20000,
  strongPower: 100,
  moveSpeed: 0.22,
  dropSpeed: 0.35,
  liftSpeed: 0.3,
  dropDepth: 1,
  grabTime: 0.7,
  topPause: 0.5,
  swingDamping: 0.4,      // 큰 기계는 줄이 길고 집게가 무거워 잘 흔들린다
  timeLimit: 30,
  price: 1000,
  controlMode: 'joystick',
  prizeMix: { bear: 8, rabbit: 6, cushion: 5 },
};

const MINI_BASE: MachineSettings = {
  ...REGULAR_BASE,
  kind: 'mini',
  guardHeight: 0.035,
  openAngleDeg: 40,
  moveSpeed: 0.12,
  dropSpeed: 0.2,
  liftSpeed: 0.17,
  nearChuteRange: 0.1,
  swingDamping: 12,        // 미니는 줄이 짧고 집게가 거의 고정되어 있어 거의 안 흔들린다 (1~2° 이내)
  payoutN: 20,
  payoutAmount: 10000,
  price: 500,
  // 미니 인형 기계도 크기가 제각각인 인형이 섞여 있다
  prizeMix: { miniDoll: 6, miniBear: 5, miniBigBear: 3, miniRabbit: 5, miniCat: 3, keyring: 4 },
};

/** difficulty: 1 쉬움 ~ 3 어려움. 오락실 기계 위 간판에 표시된다. */
export interface Preset { name: string; title: string; difficulty: 1 | 2 | 3; settings: MachineSettings; }

// 실제 오락실처럼 한 기계에는 비슷한 크기의 경품만 넣는다 (일반 인형 / 큰 인형 / 큰 박스 / 미니 인형 / 작은 박스 / 캡슐)
const REGULAR_STINGY = { liftPower: 30, topPower: 12, returnPower: 10, payoutN: 30, payoutAmount: 30000, guardHeight: 0.11, nearChuteRange: 0.28, nearChutePower: 35 };
const MINI_STINGY = { liftPower: 32, topPower: 14, returnPower: 12, payoutN: 30, payoutAmount: 15000, guardHeight: 0.1, nearChuteRange: 0.14, nearChutePower: 35 };
const BIG_DOLLS = { bigBear: 3, longCat: 4 };
// 큰 인형 기계는 배출구 가드가 인형 몸 높이(놓인 상태 약 22.5cm)보다 10% 높다: 밀어 넣기는 안 되고 들어서 넘겨야 한다
const BIG_DOLL_GUARD = 0.25;
const BIG_BOXES = { figureBox: 8, snackBox: 8 };
const CHARACTERS = { ribbonCat: 4, pinkHoodRabbit: 4, blackHoodRabbit: 4, cloudPuppy: 4, beretPuppy: 4 };
const MINI_CHARACTERS = { miniRibbonCat: 5, miniPinkHoodRabbit: 5, miniBlackHoodRabbit: 5, miniCloudPuppy: 5, miniBeretPuppy: 5 };
// 미니 인형 기계의 배출구 가드: 투명 아크릴, 누운 인형 한 개 높이쯤
const MINI_DOLL_GUARD = 0.085;
const SMALL_BOXES = { smallBox: 18 };
const SILICONE_KEYRINGS = { siliconeKeyring: 28 };
const CAPSULES = { capsule: 20 };

// 강집게 주기 무작위(±25%)는 쉬움 기계에만. 나머지는 연습하기 좋게 정확히 N판마다
const preset = (title: string, level: string, difficulty: Preset['difficulty'], base: MachineSettings, over: Partial<MachineSettings>): Preset =>
  ({ name: `${title} - ${level}`, title, difficulty, settings: { ...base, payoutSpread: difficulty === 1 ? 25 : 0, ...over } });

export const PRESETS: Preset[] = [
  preset('일반 인형', '흔한 세팅', 2, REGULAR_BASE, {}),
  preset('일반 인형', '짠물 기계', 3, REGULAR_BASE, REGULAR_STINGY),
  preset('큰 인형', '흔한 세팅', 2, REGULAR_BASE, { prizeMix: BIG_DOLLS, guardHeight: BIG_DOLL_GUARD }),
  preset('캐릭터 인형', '흔한 세팅', 2, REGULAR_BASE, { prizeMix: CHARACTERS }),
  preset('큰 박스', '흔한 세팅', 2, REGULAR_BASE, { prizeMix: BIG_BOXES }),
  preset('큰 박스', '짠물 기계', 3, REGULAR_BASE, { ...REGULAR_STINGY, prizeMix: BIG_BOXES }),
  preset('미니 인형', '흔한 세팅', 2, MINI_BASE, { guardHeight: MINI_DOLL_GUARD }),
  preset('미니 인형', '짠물 기계', 3, MINI_BASE, MINI_STINGY),
  preset('미니 캐릭터', '흔한 세팅', 2, MINI_BASE, { prizeMix: MINI_CHARACTERS, guardHeight: MINI_DOLL_GUARD }),
  preset('실리콘 키링', '흔한 세팅', 2, MINI_BASE, { prizeMix: SILICONE_KEYRINGS, guardHeight: 0.05 }),
  preset('작은 박스', '흔한 세팅', 2, MINI_BASE, { prizeMix: SMALL_BOXES }),
  preset('캡슐', '흔한 세팅', 2, MINI_BASE, { prizeMix: CAPSULES }),
];

export function cloneSettings(s: MachineSettings): MachineSettings {
  return { ...s, prizeMix: { ...s.prizeMix } };
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));

/** 실전 모드: 실제 오락실처럼 세팅을 모른 채 플레이. 현실적인 범위에서 무작위. */
export function randomizeForRealMode(base: MachineSettings): MachineSettings {
  const s = cloneSettings(base);
  s.grabPower = randInt(65, 100);
  s.liftPower = randInt(22, 65);
  s.topPower = randInt(8, Math.min(45, s.liftPower));
  s.returnPower = randInt(6, Math.min(40, s.topPower + 10));
  s.payoutMode = Math.random() < 0.8 ? 'everyN' : 'amount';
  s.payoutN = randInt(12, 32);
  s.payoutSpread = randInt(15, 35);
  s.payoutAmount = s.price * randInt(12, 32);
  s.strongPower = randInt(85, 100);
  s.dropDepth = rand(0.8, 1);
  s.swingDamping = s.kind === 'regular' ? rand(0.3, 1) : rand(10, 14);
  s.guardHeight = (s.kind === 'regular' ? rand(0.05, 0.12) : rand(0.025, 0.055));
  s.openAngleDeg = randInt(32, 42);
  // 배출구 앞 힘 빠짐은 대부분의 기계에 있다
  s.nearChuteRange = Math.random() < 0.15 ? 0 : (s.kind === 'regular' ? rand(0.12, 0.3) : rand(0.06, 0.15));
  s.nearChutePower = randInt(25, 75);
  return s;
}

/** 다음 강집게까지의 판 수(또는 금액)를 기준값 ± 편차 안에서 무작위로 뽑는다 */
export function drawPayoutTarget(s: MachineSettings): { plays: number; amount: number } {
  const jitter = () => 1 + (s.payoutSpread / 100) * (Math.random() * 2 - 1);
  return {
    plays: Math.max(1, Math.round(s.payoutN * jitter())),
    amount: Math.max(s.price, Math.round((s.payoutAmount * jitter()) / s.price) * s.price),
  };
}

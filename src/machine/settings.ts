// 기계 세팅 모델. 실제 오락실 기계의 "전압/힘 세팅"과 확률(페이아웃) 세팅을 흉내낸다.

export type MachineKind = 'regular' | 'mini';
export type PayoutMode = 'none' | 'everyN' | 'amount';
export type ControlMode = 'twoButton' | 'joystick';

export type PrizeKind =
  | 'bear' | 'rabbit' | 'cushion' | 'longCat' | 'bigBear'
  | 'figureBox' | 'snackBox' | 'keyring'
  | 'miniDoll' | 'smallBox' | 'capsule';

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
}

export const GEOMETRY: Record<MachineKind, MachineGeometry> = {
  regular: {
    width: 0.8, depth: 0.7, height: 0.95, chuteSize: 0.24,
    prongLength: 0.13, fullTorque: 0.8, hubMass: 0.6, fingerMass: 0.03, moveAccel: 1.0,
  },
  mini: {
    width: 0.42, depth: 0.38, height: 0.5, chuteSize: 0.13,
    prongLength: 0.065, fullTorque: 0.07, hubMass: 0.12, fingerMass: 0.006, moveAccel: 0.7,
  },
};

export interface MachineSettings {
  kind: MachineKind;
  // 구조 (바꾸면 재배치 필요)
  guardHeight: number;     // 배출구 가드 높이 (m)
  prongScale: number;      // 집게 발 길이 배율
  openAngleDeg: number;    // 집게 벌어짐 각도
  // 구간별 집게 힘 (%)
  grabPower: number;
  liftPower: number;
  topPower: number;
  returnPower: number;
  // 확률(페이아웃)
  payoutMode: PayoutMode;
  payoutN: number;         // N번째 판마다 강집게
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
  prongScale: 1,
  openAngleDeg: 38,
  grabPower: 85,
  liftPower: 45,
  topPower: 22,
  returnPower: 18,
  payoutMode: 'everyN',
  payoutN: 12,
  payoutAmount: 20000,
  strongPower: 100,
  moveSpeed: 0.22,
  dropSpeed: 0.35,
  liftSpeed: 0.3,
  dropDepth: 1,
  grabTime: 0.7,
  topPause: 0.5,
  swingDamping: 1.2,
  timeLimit: 30,
  price: 1000,
  controlMode: 'twoButton',
  prizeMix: { bear: 5, rabbit: 4, cushion: 3, longCat: 2, bigBear: 1, figureBox: 2, snackBox: 2, keyring: 0 },
};

const MINI_BASE: MachineSettings = {
  ...REGULAR_BASE,
  kind: 'mini',
  guardHeight: 0.035,
  openAngleDeg: 40,
  moveSpeed: 0.12,
  dropSpeed: 0.2,
  liftSpeed: 0.17,
  payoutN: 8,
  payoutAmount: 8000,
  price: 500,
  prizeMix: { keyring: 5, capsule: 7, smallBox: 4, miniDoll: 4 },
};

export interface Preset { name: string; settings: MachineSettings; }

export const PRESETS: Preset[] = [
  { name: '일반 - 흔한 오락실 세팅', settings: REGULAR_BASE },
  {
    name: '일반 - 짠물 기계',
    settings: { ...REGULAR_BASE, liftPower: 30, topPower: 12, returnPower: 10, payoutN: 20, guardHeight: 0.11 },
  },
  {
    name: '일반 - 연습용 강집게',
    settings: { ...REGULAR_BASE, grabPower: 100, liftPower: 100, topPower: 100, returnPower: 100, payoutMode: 'none' },
  },
  { name: '미니 - 흔한 세팅', settings: MINI_BASE },
  {
    name: '미니 - 짠물 기계',
    settings: { ...MINI_BASE, liftPower: 32, topPower: 14, returnPower: 12, payoutN: 15, guardHeight: 0.05 },
  },
  {
    name: '미니 - 연습용 강집게',
    settings: { ...MINI_BASE, grabPower: 100, liftPower: 100, topPower: 100, returnPower: 100, payoutMode: 'none' },
  },
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
  s.payoutN = randInt(6, 20);
  s.payoutAmount = s.price * randInt(8, 25);
  s.strongPower = randInt(85, 100);
  s.dropDepth = rand(0.8, 1);
  s.swingDamping = rand(0.6, 2);
  s.guardHeight = (s.kind === 'regular' ? rand(0.05, 0.12) : rand(0.025, 0.055));
  s.openAngleDeg = randInt(32, 42);
  return s;
}

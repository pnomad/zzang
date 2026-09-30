import * as THREE from 'three';
import type { Part, V3 } from '../physics/parts';
import type { MachineKind, PrizeKind } from '../machine/settings';

export type PrizeCategory = 'plush' | 'box' | 'capsule';

/** 스프링 관절로 달린 부위 (팔, 귀, 키링 고리). 원점 = 관절 위치. */
export interface LimbDef {
  anchor: V3;       // 몸통 기준 관절 위치
  axis: V3;         // 회전축
  parts: Part[];
  massRatio: number; // 전체 질량 중 비율
  stiffness: number;
  damping: number;
  limits: [number, number];
}

export interface PrizeDef {
  kind: PrizeKind;
  name: string;
  category: PrizeCategory;
  mass: number;      // kg
  friction: number;
  restitution: number;
  size: number;      // 대략 크기 (배치용 반지름, m)
  stack: number;     // 더미에 쌓였을 때 한 개 두께 (m). 기계 천장 높이를 정할 때 쓴다
  machines: MachineKind[];
  tip: string;       // 모양별 공략 팁
  build(color: number): { parts: Part[]; limbs: LimbDef[] };
  colors: number[];
}

const S = (r: number) => ({ type: 'ball' as const, r });
const eyes = (y: number, z: number, dx: number, r: number): Part[] => [
  { shape: S(r), pos: [-dx, y, z], color: 0x111111, mat: 'plastic', visualOnly: true },
  { shape: S(r), pos: [dx, y, z], color: 0x111111, mat: 'plastic', visualOnly: true },
];

function bearParts(sc: number, color: number, withArms: boolean): { parts: Part[]; limbs: LimbDef[] } {
  const k = (v: V3): V3 => [v[0] * sc, v[1] * sc, v[2] * sc];
  const light = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex();
  const parts: Part[] = [
    { shape: S(0.06 * sc), pos: k([0, 0.06, 0]), color, mat: 'plush' },
    { shape: S(0.055 * sc), pos: k([0, 0.16, 0]), color, mat: 'plush' },
    { shape: S(0.02 * sc), pos: k([-0.042, 0.205, 0]), color, mat: 'plush' },
    { shape: S(0.02 * sc), pos: k([0.042, 0.205, 0]), color, mat: 'plush' },
    { shape: S(0.026 * sc), pos: k([-0.035, 0.02, 0.045]), color, mat: 'plush' },
    { shape: S(0.026 * sc), pos: k([0.035, 0.02, 0.045]), color, mat: 'plush' },
    { shape: S(0.024 * sc), pos: k([0, 0.148, 0.045]), color: light, mat: 'plush', visualOnly: true },
    { shape: S(0.04 * sc), pos: k([0, 0.06, 0.028]), color: light, mat: 'plush', visualOnly: true },
    { shape: S(0.008 * sc), pos: k([0, 0.156, 0.068]), color: 0x222222, mat: 'plastic', visualOnly: true },
    ...eyes(0.175 * sc, 0.05 * sc, 0.02 * sc, 0.007 * sc),
  ];
  const limbs: LimbDef[] = [];
  const arm = (side: number): Part => ({
    shape: { type: 'capsule', hh: 0.022 * sc, r: 0.018 * sc },
    pos: k([side * 0.012, -0.028, 0.004]),
    rot: [0, 0, side * 0.45],
    color, mat: 'plush',
  });
  if (withArms) {
    for (const side of [-1, 1]) {
      limbs.push({
        anchor: k([side * 0.05, 0.1, 0]), axis: [1, 0, 0], parts: [arm(side)],
        massRatio: 0.06, stiffness: 40, damping: 3, limits: [-1.3, 1.3],
      });
    }
  } else {
    for (const side of [-1, 1]) {
      const p = arm(side);
      p.pos = k([side * 0.062, 0.072, 0.004]);
      parts.push(p);
    }
  }
  return { parts, limbs };
}

function boxTexture(bg: number, label: string, sub: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#' + bg.toString(16).padStart(6, '0');
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fillRect(0, 150, 256, 60);
  g.fillStyle = '#fff';
  g.font = 'bold 54px sans-serif';
  g.textAlign = 'center';
  g.fillText(label, 128, 105);
  g.fillStyle = '#333';
  g.font = 'bold 34px sans-serif';
  g.fillText(sub, 128, 193);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const texCache = new Map<string, THREE.Texture>();
function cachedTex(bg: number, label: string, sub: string) {
  const key = `${bg}${label}${sub}`;
  if (!texCache.has(key)) texCache.set(key, boxTexture(bg, label, sub));
  return texCache.get(key)!;
}

function ringParts(r: number, tube: number, color: number): Part[] {
  const n = 8;
  const half = r * Math.tan(Math.PI / n) + tube * 0.5;
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({
      shape: { type: 'cuboid', hx: half, hy: tube, hz: tube },
      pos: [Math.cos(a) * r, Math.sin(a) * r + r, 0],
      rot: [0, 0, a + Math.PI / 2],
      color, mat: 'metal',
    });
  }
  return out;
}

/** 인형 모양을 통째로 k배로 줄이거나 키운다 (부위 위치·크기·관절 위치 모두) */
function scaled(k: number, build: (c: number) => { parts: Part[]; limbs: LimbDef[] }) {
  const part = (p: Part): Part => {
    const sh = { ...p.shape } as Record<string, number | string>;
    for (const key of Object.keys(sh)) if (typeof sh[key] === 'number') sh[key] = (sh[key] as number) * k;
    return { ...p, shape: sh as unknown as Part['shape'], pos: p.pos && (p.pos.map((v) => v * k) as V3) };
  };
  return (c: number) => {
    const b = build(c);
    return {
      parts: b.parts.map(part),
      limbs: b.limbs.map((l) => ({ ...l, anchor: l.anchor.map((v) => v * k) as V3, parts: l.parts.map(part) })),
    };
  };
}

const PASTEL = [0xf4a7b9, 0xa7d8f4, 0xf9e79f, 0xc3aed6, 0xa8e6cf, 0xffd3b6];
const BROWN = [0xa9744f, 0xd2a679, 0x8b5a3c, 0xf5f0e6];


// ---------- 캐릭터 인형 (유명 캐릭터 분위기의 오리지널 디자인) ----------
type Build = { parts: Part[]; limbs: LimbDef[] };
const RC = (hx: number, hy: number, hz: number, br: number) => ({ type: 'roundCuboid' as const, hx, hy, hz, br });
const CAP = (hh: number, r: number) => ({ type: 'capsule' as const, hh, r });

/** 흔들리는 긴 귀 (집게 발을 걸 수 있다) */
function floppyEar(side: number, anchor: V3, color: number, len: number, r: number, spread: number, inner?: number): LimbDef {
  const parts: Part[] = [
    { shape: CAP(len, r), pos: [side * 0.004, len * 0.9, 0], rot: [0, 0, -side * spread], color, mat: 'plush' },
  ];
  if (inner !== undefined) {
    parts.push({ shape: CAP(len * 0.75, r * 0.55), pos: [side * 0.004, len * 0.9, r * 0.6], rot: [0, 0, -side * spread], color: inner, mat: 'plush', visualOnly: true });
  }
  return { anchor, axis: [1, 0, 0], massRatio: 0.05, stiffness: 25, damping: 2, limits: [-1.4, 1.4], parts };
}

/** 리본 고양이: 하얗고 넓은 얼굴, 한쪽 귀에 빨간 리본, 노란 코, 수염 */
function ribbonCat(dress: number): Build {
  const W = 0xfdfdfd, bow = 0xe03131;
  const parts: Part[] = [
    { shape: RC(0.048, 0.045, 0.038, 0.03), pos: [0, 0.05, 0], color: dress, mat: 'plush' },
    { shape: RC(0.078, 0.056, 0.058, 0.048), pos: [0, 0.148, 0], color: W, mat: 'plush' },
    { shape: S(0.02), pos: [-0.05, 0.2, 0], color: W, mat: 'plush' },
    { shape: S(0.02), pos: [0.05, 0.2, 0], color: W, mat: 'plush' },
    { shape: S(0.018), pos: [-0.032, 0.012, 0.03], color: W, mat: 'plush' },
    { shape: S(0.018), pos: [0.032, 0.012, 0.03], color: W, mat: 'plush' },
    { shape: S(0.016), pos: [-0.055, 0.075, 0.01], color: W, mat: 'plush' },
    { shape: S(0.016), pos: [0.055, 0.075, 0.01], color: W, mat: 'plush' },
    // 리본
    { shape: S(0.017), pos: [0.045, 0.21, 0.02], color: bow, mat: 'plush', visualOnly: true },
    { shape: S(0.017), pos: [0.08, 0.195, 0.02], color: bow, mat: 'plush', visualOnly: true },
    { shape: S(0.009), pos: [0.062, 0.203, 0.03], color: 0xffd43b, mat: 'plush', visualOnly: true },
    // 얼굴: 세로로 긴 까만 눈, 노란 코, 수염
    { shape: RC(0.006, 0.01, 0.004, 0.004), pos: [-0.03, 0.15, 0.057], color: 0x111111, mat: 'plastic', visualOnly: true },
    { shape: RC(0.006, 0.01, 0.004, 0.004), pos: [0.03, 0.15, 0.057], color: 0x111111, mat: 'plastic', visualOnly: true },
    { shape: RC(0.009, 0.006, 0.004, 0.004), pos: [0, 0.135, 0.058], color: 0xfab005, mat: 'plastic', visualOnly: true },
  ];
  for (const side of [-1, 1]) for (const dy of [0.006, -0.008]) {
    parts.push({ shape: { type: 'cuboid', hx: 0.017, hy: 0.0012, hz: 0.0012 }, pos: [side * 0.07, 0.14 + dy, 0.045], rot: [0, 0, side * dy * 12], color: 0x222222, mat: 'plastic', visualOnly: true });
  }
  return { parts, limbs: [] };
}

/** 두건 토끼: 두건과 긴 귀가 한 몸, 하얀 얼굴 (분홍 두건 + 꽃 / 검정 두건 + 이마 장식) */
function hoodRabbit(hood: number, variant: 'pink' | 'black'): Build {
  const W = 0xfdfdfd;
  const body = variant === 'pink' ? 0xf8c8dc : 0x1a1a1f;
  const parts: Part[] = [
    { shape: S(0.05), pos: [0, 0.05, 0], color: body, mat: 'plush' },
    { shape: S(0.064), pos: [0, 0.15, -0.006], color: hood, mat: 'plush' },
    { shape: RC(0.045, 0.036, 0.02, 0.018), pos: [0, 0.14, 0.042], color: W, mat: 'plush', visualOnly: true },
    { shape: S(0.018), pos: [-0.03, 0.012, 0.03], color: hood, mat: 'plush' },
    { shape: S(0.018), pos: [0.03, 0.012, 0.03], color: hood, mat: 'plush' },
    ...eyes(0.142, 0.06, 0.02, 0.0065),
    { shape: S(0.005), pos: [0, 0.13, 0.062], color: variant === 'pink' ? 0xfab005 : 0xf783ac, mat: 'plastic', visualOnly: true },
  ];
  if (variant === 'pink') {
    parts.push({ shape: S(0.012), pos: [0.04, 0.2, 0.03], color: 0xff6b9a, mat: 'plush', visualOnly: true });
    parts.push({ shape: S(0.006), pos: [0.04, 0.2, 0.04], color: 0xffd43b, mat: 'plush', visualOnly: true });
  } else {
    parts.push({ shape: S(0.011), pos: [0, 0.2, 0.05], color: 0xf783ac, mat: 'plush', visualOnly: true });
  }
  const tipped = variant === 'black' ? 0.35 : 0.1;
  const inner = variant === 'pink' ? 0xfff0f6 : undefined;
  const len = variant === 'pink' ? 0.052 : 0.042;
  return {
    parts,
    limbs: [
      floppyEar(-1, [-0.03, 0.2, -0.01], hood, len, 0.016, tipped, inner),
      floppyEar(1, [0.03, 0.2, -0.01], hood, len, 0.016, tipped, inner),
    ],
  };
}

/** 구름 강아지: 하얀 몸, 양옆으로 축 늘어진 큰 귀, 파란 눈, 말린 꼬리 */
function cloudPuppy(): Build {
  const W = 0xfdfdfd;
  const parts: Part[] = [
    { shape: S(0.05), pos: [0, 0.05, 0], color: W, mat: 'plush' },
    { shape: RC(0.066, 0.058, 0.058, 0.05), pos: [0, 0.15, 0], color: W, mat: 'plush' },
    { shape: S(0.016), pos: [-0.028, 0.012, 0.03], color: W, mat: 'plush' },
    { shape: S(0.016), pos: [0.028, 0.012, 0.03], color: W, mat: 'plush' },
    { shape: S(0.02), pos: [0, 0.06, -0.055], color: W, mat: 'plush' }, // 말린 꼬리
    ...eyes(0.15, 0.056, 0.024, 0.008),
    { shape: S(0.0035), pos: [-0.026, 0.153, 0.063], color: 0x4dabf7, mat: 'plastic', visualOnly: true },
    { shape: S(0.0035), pos: [0.026, 0.153, 0.063], color: 0x4dabf7, mat: 'plastic', visualOnly: true },
    { shape: S(0.011), pos: [-0.042, 0.132, 0.05], color: 0xffc9de, mat: 'plush', visualOnly: true },
    { shape: S(0.011), pos: [0.042, 0.132, 0.05], color: 0xffc9de, mat: 'plush', visualOnly: true },
  ];
  // 귀는 옆으로 축 늘어진다 (경첩축이 앞뒤라 위아래로 펄럭)
  const ear = (side: number): LimbDef => ({
    anchor: [side * 0.055, 0.185, 0], axis: [0, 0, 1], massRatio: 0.06, stiffness: 18, damping: 2, limits: [-0.9, 0.9],
    parts: [{ shape: RC(0.048, 0.01, 0.028, 0.009), pos: [side * 0.045, -0.012, 0], rot: [0, 0, -side * 0.35], color: W, mat: 'plush' }],
  });
  return { parts, limbs: [ear(-1), ear(1)] };
}

/** 베레모 강아지: 노란 몸, 갈색 베레모, 늘어진 갈색 귀 */
function beretPuppy(): Build {
  const Y = 0xf7d774, B = 0x8b5a3c;
  const parts: Part[] = [
    { shape: RC(0.056, 0.05, 0.048, 0.04), pos: [0, 0.052, 0], color: Y, mat: 'plush' },
    { shape: RC(0.068, 0.056, 0.058, 0.05), pos: [0, 0.152, 0], color: Y, mat: 'plush' },
    { shape: S(0.018), pos: [-0.032, 0.012, 0.035], color: Y, mat: 'plush' },
    { shape: S(0.018), pos: [0.032, 0.012, 0.035], color: Y, mat: 'plush' },
    { shape: { type: 'cylinder', hh: 0.009, r: 0.042 }, pos: [0.006, 0.212, -0.004], rot: [0.12, 0, 0.1], color: B, mat: 'plush' },
    { shape: S(0.008), pos: [0.008, 0.224, -0.004], color: B, mat: 'plush', visualOnly: true },
    { shape: RC(0.012, 0.03, 0.02, 0.01), pos: [-0.072, 0.14, 0], rot: [0, 0, 0.15], color: B, mat: 'plush' },
    { shape: RC(0.012, 0.03, 0.02, 0.01), pos: [0.072, 0.14, 0], rot: [0, 0, -0.15], color: B, mat: 'plush' },
    ...eyes(0.155, 0.057, 0.024, 0.0075),
    { shape: S(0.007), pos: [0, 0.14, 0.062], color: 0x5c3a21, mat: 'plastic', visualOnly: true },
  ];
  return { parts, limbs: [] };
}


/** 부품 목록을 dy만큼 위로 옮긴다 */
const lift = (parts: Part[], dy: number): Part[] => parts.map((p) => ({ ...p, pos: [p.pos?.[0] ?? 0, (p.pos?.[1] ?? 0) + dy, p.pos?.[2] ?? 0] as V3 }));

/** 부품들이 차지하는 가장 높은 곳 (대략) */
function topOf(parts: Part[]): number {
  let top = 0;
  for (const p of parts) {
    const s = p.shape;
    const h = s.type === 'ball' ? s.r : s.type === 'capsule' ? s.hh + s.r : s.type === 'cylinder' ? s.hh : s.hy;
    top = Math.max(top, (p.pos?.[1] ?? 0) + h);
  }
  return top;
}

/**
 * 미니 인형에 달린 종이 택 또는 키링 줄 (실제 미니 기계 인형은 둘 중 하나가 꼭 달려 있다).
 * 키링 줄은 금속 고리 때문에 인형만큼 무거워서, 옮길 때 가드에 걸리면 인형을 뒤로 끌어당긴다.
 * 반환: 관절로 매달 부위와 그 무게(kg)
 */
export function tagAttachment(parts: Part[], dollMass: number): { limb: LimbDef; mass: number } {
  const anchor: V3 = [0, topOf(parts) * 0.92, 0];
  const loose = { axis: [1, 0, 0] as V3, massRatio: 0, stiffness: 0, damping: 0.0004, limits: [-2.9, 2.9] as [number, number] };
  if (Math.random() < 0.6) {
    const strap = [0x4dabf7, 0xf783ac, 0xffd43b, 0x69db7c][Math.floor(Math.random() * 4)];
    const gold = 0xd4af37;
    return {
      mass: dollMass * 0.7,
      limb: {
        ...loose, anchor,
        parts: [
          { shape: CAP(0.016, 0.0035), pos: [0, 0.016, 0], color: strap, mat: 'plastic' },
          { shape: { type: 'cuboid', hx: 0.004, hy: 0.007, hz: 0.003 }, pos: [0, 0.038, 0], color: gold, mat: 'metal' },
          ...lift(ringParts(0.01, 0.0017, gold), 0.044),
        ],
      },
    };
  }
  const card = [0x3b5bdb, 0x7048e8, 0xf8f9fa][Math.floor(Math.random() * 3)];
  return {
    mass: dollMass * 0.08,
    limb: {
      ...loose, anchor,
      parts: [
        { shape: CAP(0.01, 0.0012), pos: [0, 0.01, 0], color: 0xffffff, mat: 'plastic' },
        { shape: { type: 'cuboid', hx: 0.02, hy: 0.028, hz: 0.0012 }, pos: [0, 0.048, 0], color: card, mat: 'box' },
        { shape: { type: 'cuboid', hx: 0.016, hy: 0.004, hz: 0.0014 }, pos: [0, 0.058, 0], color: 0xffd43b, mat: 'box', visualOnly: true },
      ],
    },
  };
}

/** 실리콘 키링: 작은 치즈 블록 캐릭터 + 긴 실리콘 줄 + 금속 고리 */
function siliconeKeyring(c: number): Build {
  const strap = [0xf783ac, 0xb2f2bb, 0xffe066, 0xd0bfff][Math.floor(Math.random() * 4)];
  const parts: Part[] = [
    { shape: RC(0.02, 0.016, 0.011, 0.006), pos: [0, 0.016, 0], color: c, mat: 'plastic' },
    ...eyes(0.02, 0.011, 0.007, 0.0035),
    { shape: S(0.004), pos: [0, 0.012, 0.011], color: 0xff8fab, mat: 'plastic', visualOnly: true },
    { shape: S(0.003), pos: [-0.012, 0.024, 0.01], color: 0x000000, mat: 'dark', visualOnly: true },
    { shape: S(0.0025), pos: [0.013, 0.008, 0.01], color: 0x000000, mat: 'dark', visualOnly: true },
  ];
  const limb: LimbDef = {
    anchor: [0, 0.03, 0], axis: [1, 0, 0], massRatio: 0.45, stiffness: 0, damping: 0.0004, limits: [-2.9, 2.9],
    parts: [
      { shape: RC(0.009, 0.05, 0.0025, 0.002), pos: [0, 0.05, 0], color: strap, mat: 'plastic' },
      { shape: { type: 'cylinder', hh: 0.003, r: 0.0035 }, pos: [0, 0.097, 0], rot: [Math.PI / 2, 0, 0], color: 0xced4da, mat: 'metal', visualOnly: true },
      ...lift(ringParts(0.011, 0.0018, 0xd4af37), 0.1),
    ],
  };
  return { parts, limbs: [limb] };
}

const CHAR_TIP = {
  cat: '머리가 넓고 무거워서 몸통보다 머리 아래(목)를 감싸야 안 빠져요. 리본 쪽이 살짝 더 무거워요.',
  rabbit: '긴 귀가 걸기 포인트예요. 귀 밑에 발 하나만 걸려도 딸려 올라와요.',
  puppy: '옆으로 늘어진 큰 귀 밑으로 발이 들어가면 잘 걸려요. 몸이 둥글어서 정면으로는 잘 미끄러져요.',
  beret: '몸이 통통해서 발이 잘 안 감겨요. 머리 쪽을 노려 베레모 밑에 발을 걸어 보세요.',
};

export const PRIZES: Record<PrizeKind, PrizeDef> = {
  bear: {
    kind: 'bear', name: '곰 인형', category: 'plush', mass: 0.25, friction: 1.1, restitution: 0.05,
    size: 0.11, stack: 0.15, machines: ['regular'], colors: BROWN,
    tip: '머리가 커서 무게중심이 위쪽이에요. 몸통보다 목 부분을 감싸듯 노리면 잘 안 빠져요.',
    build: (c) => bearParts(1, c, true),
  },
  rabbit: {
    kind: 'rabbit', name: '토끼 인형', category: 'plush', mass: 0.2, friction: 1.1, restitution: 0.05,
    size: 0.1, stack: 0.14, machines: ['regular'], colors: [0xffffff, 0xf4c2d7, 0xd9d9d9, 0xe8d5b7],
    tip: '긴 귀가 걸기 포인트예요. 귀 사이나 귀 밑에 발 하나가 들어가면 힘이 약해도 걸려 올라와요.',
    build: (c) => {
      const inner = 0xf7a8c4;
      const parts: Part[] = [
        { shape: { type: 'capsule', hh: 0.035, r: 0.045 }, pos: [0, 0.08, 0], color: c, mat: 'plush' },
        { shape: S(0.047), pos: [0, 0.165, 0], color: c, mat: 'plush' },
        { shape: S(0.022), pos: [-0.028, 0.022, 0.035], color: c, mat: 'plush' },
        { shape: S(0.022), pos: [0.028, 0.022, 0.035], color: c, mat: 'plush' },
        { shape: S(0.016), pos: [0, 0.05, -0.045], color: 0xffffff, mat: 'plush', visualOnly: true },
        { shape: S(0.007), pos: [0, 0.158, 0.046], color: inner, mat: 'plastic', visualOnly: true },
        ...eyes(0.175, 0.04, 0.02, 0.0065),
      ];
      const ear = (side: number): LimbDef => ({
        anchor: [side * 0.02, 0.2, 0], axis: [1, 0, 0], massRatio: 0.05,
        stiffness: 25, damping: 2, limits: [-1.4, 1.4],
        parts: [
          { shape: { type: 'capsule', hh: 0.045, r: 0.014 }, pos: [side * 0.006, 0.055, 0], rot: [0, 0, -side * 0.12], color: c, mat: 'plush' },
          { shape: { type: 'capsule', hh: 0.035, r: 0.008 }, pos: [side * 0.006, 0.055, 0.008], rot: [0, 0, -side * 0.12], color: inner, mat: 'plush', visualOnly: true },
        ],
      });
      return { parts, limbs: [ear(-1), ear(1)] };
    },
  },
  cushion: {
    kind: 'cushion', name: '납작 쿠션', category: 'plush', mass: 0.15, friction: 0.85, restitution: 0.05,
    size: 0.1, stack: 0.12, machines: ['regular'], colors: PASTEL,
    tip: '납작해서 발이 밑으로 잘 안 들어가요. 모서리를 노려 세우거나 밀어서 배출구 쪽으로 옮기세요.',
    build: (c) => ({
      parts: [
        { shape: { type: 'roundCuboid', hx: 0.09, hy: 0.028, hz: 0.075, br: 0.024 }, pos: [0, 0.028, 0], color: c, mat: 'plush' },
        ...eyes(0.056, 0.02, 0.03, 0.009),
        { shape: S(0.012), pos: [-0.055, 0.052, 0.035], color: 0xff8fab, mat: 'plush', visualOnly: true },
        { shape: S(0.012), pos: [0.055, 0.052, 0.035], color: 0xff8fab, mat: 'plush', visualOnly: true },
      ],
      limbs: [],
    }),
  },
  longCat: {
    kind: 'longCat', name: '롱 고양이', category: 'plush', mass: 0.22, friction: 1.0, restitution: 0.05,
    size: 0.15, stack: 0.15, machines: ['regular'], colors: [0x444444, 0xf5f0e6, 0xf2a65a, 0x9e9e9e],
    tip: '길쭉해서 가운데를 잡으면 양쪽이 처져 빠져요. 머리 쪽(무거운 쪽) 1/3 지점을 노리세요.',
    build: (c) => ({
      parts: [
        { shape: { type: 'capsule', hh: 0.1, r: 0.036 }, pos: [-0.02, 0.036, 0], rot: [0, 0, Math.PI / 2], color: c, mat: 'plush' },
        { shape: S(0.05), pos: [0.12, 0.05, 0], color: c, mat: 'plush' },
        { shape: S(0.016), pos: [0.13, 0.095, -0.028], color: c, mat: 'plush' },
        { shape: S(0.016), pos: [0.13, 0.095, 0.028], color: c, mat: 'plush' },
        { shape: S(0.006), pos: [0.168, 0.06, -0.018], color: 0x111111, visualOnly: true },
        { shape: S(0.006), pos: [0.168, 0.06, 0.018], color: 0x111111, visualOnly: true },
      ],
      limbs: [],
    }),
  },
  bigBear: {
    kind: 'bigBear', name: '대형 곰', category: 'plush', mass: 0.75, friction: 1.1, restitution: 0.03,
    size: 0.17, stack: 0.22, machines: ['regular'], colors: [0xd2a679, 0xf5f0e6],
    tip: '무거워서 들어 올리기 어려워요. 한 번에 뽑기보다 조금씩 배출구 쪽으로 끌어오는 게 현실적이에요.',
    build: (c) => bearParts(1.55, c, true),
  },
  figureBox: {
    kind: 'figureBox', name: '피규어 상자', category: 'box', mass: 0.28, friction: 0.35, restitution: 0.1,
    size: 0.1, stack: 0.12, machines: ['regular'], colors: [0x2d6cdf, 0xd6336c, 0x2b8a3e],
    tip: '딱딱하고 미끄러워서 집어도 빠져요. 모서리에 발을 걸어 기울이거나 넘어뜨려 배출구로 보내세요.',
    build: (c) => ({
      parts: [{
        shape: { type: 'cuboid', hx: 0.055, hy: 0.085, hz: 0.04 }, pos: [0, 0.085, 0],
        color: 0xffffff, mat: 'box', map: cachedTex(c, 'FIGURE', 'SPECIAL'),
      }],
      limbs: [],
    }),
  },
  snackBox: {
    kind: 'snackBox', name: '과자 상자', category: 'box', mass: 0.12, friction: 0.4, restitution: 0.1,
    size: 0.1, stack: 0.08, machines: ['regular'], colors: [0xf08c00, 0xe03131, 0x7048e8],
    tip: '가볍지만 납작하고 넓어요. 긴 쪽 끝을 들어 올려 세우거나, 밀어서 떨어뜨리는 게 잘 먹혀요.',
    build: (c) => ({
      parts: [{
        shape: { type: 'cuboid', hx: 0.085, hy: 0.028, hz: 0.05 }, pos: [0, 0.028, 0],
        color: 0xffffff, mat: 'box', map: cachedTex(c, 'SNACK', '과자'),
      }],
      limbs: [],
    }),
  },
  keyring: {
    kind: 'keyring', name: '키링 인형', category: 'plush', mass: 0.035, friction: 1.0, restitution: 0.05,
    size: 0.05, stack: 0.06, machines: ['regular', 'mini'], colors: PASTEL,
    tip: '고리(링)가 핵심이에요. 발 끝을 고리에 걸면 힘과 상관없이 딸려 올라와요.',
    build: (c) => {
      const b = bearParts(0.42, c, false);
      b.limbs.push({
        anchor: [0, 0.225 * 0.42, 0], axis: [0, 0, 1], massRatio: 0.1,
        stiffness: 3, damping: 0.5, limits: [-1.5, 1.5],
        parts: ringParts(0.016, 0.0022, 0xd4d4d4),
      });
      return b;
    },
  },
  miniDoll: {
    kind: 'miniDoll', name: '미니 인형', category: 'plush', mass: 0.06, friction: 1.05, restitution: 0.05,
    size: 0.07, stack: 0.1, machines: ['mini'], colors: [...PASTEL, ...BROWN],
    tip: '작고 가벼워서 집게 안에 들어오기만 하면 잘 올라와요. 머리 위를 정확히 노리세요.',
    build: (c) => bearParts(0.58, c, false),
  },
  miniBear: {
    kind: 'miniBear', name: '꼬마 곰', category: 'plush', mass: 0.04, friction: 1.05, restitution: 0.05,
    size: 0.055, stack: 0.08, machines: ['mini'], colors: BROWN,
    tip: '미니 기계에서도 작은 편이라 집게 안에 쏙 들어가요. 대신 발 사이로 빠지기 쉬우니 한가운데를 노리세요.',
    build: (c) => bearParts(0.46, c, false),
  },
  miniBigBear: {
    kind: 'miniBigBear', name: '큰 미니 곰', category: 'plush', mass: 0.08, friction: 1.1, restitution: 0.04,
    size: 0.075, stack: 0.11, machines: ['mini'], colors: [...BROWN, 0xf4a7b9],
    tip: '미니 기계치고 커서 집게가 다 감싸지 못해요. 팔 밑이나 목에 발을 걸어 들어 올리세요.',
    build: (c) => bearParts(0.66, c, true), // 키 약 15cm: 미니 기계에서 제일 크지만 일반 곰(23cm)보다는 확실히 작게
  },
  miniRabbit: {
    kind: 'miniRabbit', name: '미니 토끼', category: 'plush', mass: 0.045, friction: 1.1, restitution: 0.05,
    size: 0.065, stack: 0.095, machines: ['mini'], colors: [0xffffff, 0xf4c2d7, 0xd9d9d9, 0xe8d5b7],
    tip: '큰 토끼처럼 귀가 걸기 포인트예요. 귀 밑에 발 하나만 들어가도 딸려 올라와요.',
    build: (c) => scaled(0.65, PRIZES.rabbit.build)(c), // 큰 토끼 모양을 줄여서
  },
  miniCat: {
    kind: 'miniCat', name: '미니 롱 고양이', category: 'plush', mass: 0.04, friction: 1.0, restitution: 0.05,
    size: 0.09, stack: 0.06, machines: ['mini'], colors: [0x444444, 0xf5f0e6, 0xf2a65a, 0x9e9e9e],
    tip: '가볍지만 길쭉해서 가운데를 잡으면 양쪽이 처져요. 머리 쪽을 노리세요.',
    build: (c) => scaled(0.6, PRIZES.longCat.build)(c),
  },
  // ---- 캐릭터 인형 (일반) ----
  ribbonCat: {
    kind: 'ribbonCat', name: '리본 고양이', category: 'plush', mass: 0.2, friction: 1.1, restitution: 0.05,
    size: 0.1, stack: 0.14, machines: ['regular'], colors: [0x4dabf7, 0xe03131, 0xf783ac],
    tip: CHAR_TIP.cat, build: (c) => ribbonCat(c),
  },
  pinkHoodRabbit: {
    kind: 'pinkHoodRabbit', name: '분홍 두건 토끼', category: 'plush', mass: 0.18, friction: 1.1, restitution: 0.05,
    size: 0.1, stack: 0.14, machines: ['regular'], colors: [0xffa8c5],
    tip: CHAR_TIP.rabbit, build: (c) => hoodRabbit(c, 'pink'),
  },
  blackHoodRabbit: {
    kind: 'blackHoodRabbit', name: '검정 두건 토끼', category: 'plush', mass: 0.18, friction: 1.1, restitution: 0.05,
    size: 0.1, stack: 0.14, machines: ['regular'], colors: [0x1a1a1f],
    tip: CHAR_TIP.rabbit, build: (c) => hoodRabbit(c, 'black'),
  },
  cloudPuppy: {
    kind: 'cloudPuppy', name: '구름 강아지', category: 'plush', mass: 0.17, friction: 1.05, restitution: 0.05,
    size: 0.11, stack: 0.14, machines: ['regular'], colors: [0xfdfdfd],
    tip: CHAR_TIP.puppy, build: () => cloudPuppy(),
  },
  beretPuppy: {
    kind: 'beretPuppy', name: '베레모 강아지', category: 'plush', mass: 0.22, friction: 1.05, restitution: 0.05,
    size: 0.1, stack: 0.15, machines: ['regular'], colors: [0xf7d774],
    tip: CHAR_TIP.beret, build: () => beretPuppy(),
  },
  // ---- 캐릭터 인형 (미니: 같은 모양을 0.6배로, 12~14cm 키링 인형) ----
  miniRibbonCat: {
    kind: 'miniRibbonCat', name: '미니 리본 고양이', category: 'plush', mass: 0.046, friction: 1.1, restitution: 0.05,
    size: 0.06, stack: 0.084, machines: ['mini'], colors: [0x4dabf7, 0xe03131, 0xf783ac],
    tip: CHAR_TIP.cat, build: (c) => scaled(0.6, ribbonCat)(c),
  },
  miniPinkHoodRabbit: {
    kind: 'miniPinkHoodRabbit', name: '미니 분홍 두건 토끼', category: 'plush', mass: 0.042, friction: 1.1, restitution: 0.05,
    size: 0.06, stack: 0.084, machines: ['mini'], colors: [0xffa8c5],
    tip: CHAR_TIP.rabbit, build: (c) => scaled(0.6, (cc) => hoodRabbit(cc, 'pink'))(c),
  },
  miniBlackHoodRabbit: {
    kind: 'miniBlackHoodRabbit', name: '미니 검정 두건 토끼', category: 'plush', mass: 0.042, friction: 1.1, restitution: 0.05,
    size: 0.06, stack: 0.084, machines: ['mini'], colors: [0x1a1a1f],
    tip: CHAR_TIP.rabbit, build: (c) => scaled(0.6, (cc) => hoodRabbit(cc, 'black'))(c),
  },
  miniCloudPuppy: {
    kind: 'miniCloudPuppy', name: '미니 구름 강아지', category: 'plush', mass: 0.039, friction: 1.05, restitution: 0.05,
    size: 0.066, stack: 0.084, machines: ['mini'], colors: [0xfdfdfd],
    tip: CHAR_TIP.puppy, build: () => scaled(0.6, cloudPuppy)(0),
  },
  miniBeretPuppy: {
    kind: 'miniBeretPuppy', name: '미니 베레모 강아지', category: 'plush', mass: 0.049, friction: 1.05, restitution: 0.05,
    size: 0.06, stack: 0.09, machines: ['mini'], colors: [0xf7d774],
    tip: CHAR_TIP.beret, build: () => scaled(0.6, beretPuppy)(0),
  },
  siliconeKeyring: {
    kind: 'siliconeKeyring', name: '실리콘 키링', category: 'box', mass: 0.03, friction: 0.8, restitution: 0.15,
    size: 0.055, stack: 0.03, machines: ['mini'], colors: [0xffd43b, 0xff8fab, 0x9ad0f5, 0xb2f2bb],
    tip: '몸통은 작고 딱딱해서 직접 집기 어려워요. 긴 줄이나 고리에 발 하나만 걸면 딸려 올라와요.',
    build: (c) => siliconeKeyring(c),
  },
  smallBox: {
    kind: 'smallBox', name: '미니 상자', category: 'box', mass: 0.035, friction: 0.38, restitution: 0.1,
    size: 0.04, stack: 0.064, machines: ['mini'], colors: [0x1971c2, 0xe8590c, 0x0ca678, 0xae3ec9],
    tip: '미끄러운 상자예요. 세워져 있으면 넘어뜨리기, 누워 있으면 모서리를 대각선으로 잡으세요.',
    build: (c) => ({
      parts: [{
        shape: { type: 'cuboid', hx: 0.022, hy: 0.032, hz: 0.018 }, pos: [0, 0.032, 0],
        color: 0xffffff, mat: 'box', map: cachedTex(c, 'MINI', 'BOX'),
      }],
      limbs: [],
    }),
  },
  capsule: {
    kind: 'capsule', name: '캡슐볼', category: 'capsule', mass: 0.035, friction: 0.22, restitution: 0.3,
    size: 0.03, stack: 0.07, machines: ['mini'], colors: [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xda77f2],
    tip: '동그랗고 미끄러워서 집게가 쉽게 빠져요. 다른 캡슐 사이에 끼인 것을 노리거나 굴려서 보내세요.',
    build: (c) => {
      const r = 0.028;
      return {
        parts: [
          { shape: S(r), pos: [0, r, 0], color: c, mat: 'plastic', visualOnly: true,
            geometry: new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2) },
          { shape: S(r), pos: [0, r, 0], color: 0xffffff, mat: 'clear',
            geometry: new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2) },
          { shape: S(r * 0.45), pos: [0, r * 1.1, 0], color: PASTEL[Math.floor(Math.random() * PASTEL.length)], mat: 'plush', visualOnly: true },
        ],
        limbs: [],
      };
    },
  },
};

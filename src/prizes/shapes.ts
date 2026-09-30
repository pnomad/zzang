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

const PASTEL = [0xf4a7b9, 0xa7d8f4, 0xf9e79f, 0xc3aed6, 0xa8e6cf, 0xffd3b6];
const BROWN = [0xa9744f, 0xd2a679, 0x8b5a3c, 0xf5f0e6];

export const PRIZES: Record<PrizeKind, PrizeDef> = {
  bear: {
    kind: 'bear', name: '곰 인형', category: 'plush', mass: 0.25, friction: 1.1, restitution: 0.05,
    size: 0.11, machines: ['regular'], colors: BROWN,
    tip: '머리가 커서 무게중심이 위쪽이에요. 몸통보다 목 부분을 감싸듯 노리면 잘 안 빠져요.',
    build: (c) => bearParts(1, c, true),
  },
  rabbit: {
    kind: 'rabbit', name: '토끼 인형', category: 'plush', mass: 0.2, friction: 1.1, restitution: 0.05,
    size: 0.1, machines: ['regular'], colors: [0xffffff, 0xf4c2d7, 0xd9d9d9, 0xe8d5b7],
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
    size: 0.1, machines: ['regular'], colors: PASTEL,
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
    size: 0.15, machines: ['regular'], colors: [0x444444, 0xf5f0e6, 0xf2a65a, 0x9e9e9e],
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
    size: 0.17, machines: ['regular'], colors: [0xd2a679, 0xf5f0e6],
    tip: '무거워서 들어 올리기 어려워요. 한 번에 뽑기보다 조금씩 배출구 쪽으로 끌어오는 게 현실적이에요.',
    build: (c) => bearParts(1.55, c, true),
  },
  figureBox: {
    kind: 'figureBox', name: '피규어 상자', category: 'box', mass: 0.28, friction: 0.35, restitution: 0.1,
    size: 0.1, machines: ['regular'], colors: [0x2d6cdf, 0xd6336c, 0x2b8a3e],
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
    size: 0.1, machines: ['regular'], colors: [0xf08c00, 0xe03131, 0x7048e8],
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
    size: 0.05, machines: ['regular', 'mini'], colors: PASTEL,
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
    size: 0.06, machines: ['mini'], colors: [...PASTEL, ...BROWN],
    tip: '작고 가벼워서 집게 안에 들어오기만 하면 잘 올라와요. 머리 위를 정확히 노리세요.',
    build: (c) => bearParts(0.5, c, false),
  },
  smallBox: {
    kind: 'smallBox', name: '미니 상자', category: 'box', mass: 0.035, friction: 0.38, restitution: 0.1,
    size: 0.04, machines: ['mini'], colors: [0x1971c2, 0xe8590c, 0x0ca678, 0xae3ec9],
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
    size: 0.03, machines: ['mini'], colors: [0xff6b6b, 0x4dabf7, 0xffd43b, 0x69db7c, 0xda77f2],
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

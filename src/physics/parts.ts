import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RAPIER } from './world';

export type V3 = [number, number, number];

export type Shape =
  | { type: 'ball'; r: number }
  | { type: 'cuboid'; hx: number; hy: number; hz: number }
  | { type: 'roundCuboid'; hx: number; hy: number; hz: number; br: number } // h = 전체 반지름(테두리 포함)
  | { type: 'capsule'; hh: number; r: number }
  | { type: 'cylinder'; hh: number; r: number };

export type MaterialKind = 'plush' | 'plastic' | 'box' | 'metal' | 'clear' | 'dark';

/** 충돌체 + 화면 메시를 동시에 정의하는 파츠 */
export interface Part {
  shape: Shape;
  pos?: V3;
  rot?: V3; // 오일러 (rad)
  color?: number;
  mat?: MaterialKind;
  visualOnly?: boolean;
  map?: THREE.Texture;
  /** 반구 등 특수 메시 (충돌은 shape 사용) */
  geometry?: THREE.BufferGeometry;
}

export function shapeVolume(s: Shape): number {
  switch (s.type) {
    case 'ball': return (4 / 3) * Math.PI * s.r ** 3;
    case 'cuboid': return 8 * s.hx * s.hy * s.hz;
    case 'roundCuboid': return 8 * s.hx * s.hy * s.hz;
    case 'capsule': return Math.PI * s.r ** 2 * 2 * s.hh + (4 / 3) * Math.PI * s.r ** 3;
    case 'cylinder': return Math.PI * s.r ** 2 * 2 * s.hh;
  }
}

/** 인형처럼 말랑한 경품은 충돌 형태를 겉모습보다 작게(속심) 만들어 발이 솜 속으로 파고들게 한다 */
export function shrinkShape(s: Shape, k: number): Shape {
  if (k === 1) return s;
  switch (s.type) {
    case 'ball': return { ...s, r: s.r * k };
    case 'cuboid': return { ...s, hx: s.hx * k, hy: s.hy * k, hz: s.hz * k };
    case 'roundCuboid': return { ...s, hx: s.hx * k, hy: s.hy * k, hz: s.hz * k, br: s.br * k };
    case 'capsule': return { ...s, r: s.r * k, hh: s.hh + s.r * (1 - k) };
    case 'cylinder': return { ...s, r: s.r * k, hh: s.hh * k };
  }
}

/** 이미 만든 충돌체를 모양 s의 k배 크기로, 위치도 강체 원점 쪽으로 k배 (인형이 눌려 줄어들 때) */
export function resizeCollider(col: RAPIER.Collider, s: Shape, pos: V3, k: number) {
  switch (s.type) {
    case 'ball': col.setRadius(s.r * k); break;
    case 'cuboid': col.setHalfExtents({ x: s.hx * k, y: s.hy * k, z: s.hz * k }); break;
    case 'roundCuboid':
      col.setHalfExtents({ x: (s.hx - s.br) * k, y: (s.hy - s.br) * k, z: (s.hz - s.br) * k });
      col.setRoundRadius(s.br * k);
      break;
    case 'capsule': col.setHalfHeight(s.hh * k); col.setRadius(s.r * k); break;
    case 'cylinder': col.setHalfHeight(s.hh * k); col.setRadius(s.r * k); break;
  }
  col.setTranslationWrtParent({ x: pos[0] * k, y: pos[1] * k, z: pos[2] * k });
}

export function colliderDesc(s: Shape): RAPIER.ColliderDesc {
  switch (s.type) {
    case 'ball': return RAPIER.ColliderDesc.ball(s.r);
    case 'cuboid': return RAPIER.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
    case 'roundCuboid':
      return RAPIER.ColliderDesc.roundCuboid(s.hx - s.br, s.hy - s.br, s.hz - s.br, s.br);
    case 'capsule': return RAPIER.ColliderDesc.capsule(s.hh, s.r);
    case 'cylinder': return RAPIER.ColliderDesc.cylinder(s.hh, s.r);
  }
}

function geometryFor(s: Shape): THREE.BufferGeometry {
  switch (s.type) {
    case 'ball': return new THREE.SphereGeometry(s.r, 20, 14);
    case 'cuboid': return new THREE.BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2);
    case 'roundCuboid': return new RoundedBoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2, 3, s.br);
    case 'capsule': return new THREE.CapsuleGeometry(s.r, s.hh * 2, 6, 14);
    case 'cylinder': return new THREE.CylinderGeometry(s.r, s.r, s.hh * 2, 20);
  }
}

const matCache = new Map<string, THREE.Material>();

export function material(kind: MaterialKind, color: number, map?: THREE.Texture): THREE.Material {
  const key = `${kind}:${color}:${map?.uuid ?? ''}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  let m: THREE.Material;
  switch (kind) {
    case 'plush':
      m = new THREE.MeshPhysicalMaterial({
        color, roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff),
      });
      break;
    case 'plastic':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0 });
      break;
    case 'box':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, map: map ?? null });
      break;
    case 'metal':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.9 });
      break;
    case 'clear':
      m = new THREE.MeshPhysicalMaterial({
        color, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false,
      });
      break;
    case 'dark':
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
      break;
  }
  matCache.set(key, m);
  return m;
}

export function meshFor(p: Part): THREE.Mesh {
  const mesh = new THREE.Mesh(
    p.geometry ?? geometryFor(p.shape),
    material(p.mat ?? 'plastic', p.color ?? 0xffffff, p.map),
  );
  if (p.pos) mesh.position.set(...p.pos);
  if (p.rot) mesh.rotation.set(...p.rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function partRotation(p: Part): { x: number; y: number; z: number; w: number } {
  const q = new THREE.Quaternion();
  if (p.rot) q.setFromEuler(new THREE.Euler(...p.rot));
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** 파츠 목록을 강체에 붙이고 메시 그룹을 만든다. 질량은 부피 비율로 나눈다. */
export function attachParts(
  world: RAPIER.World,
  body: RAPIER.RigidBody,
  parts: Part[],
  opts: { mass: number; friction: number; restitution: number; groups: number; core?: number },
): { group: THREE.Group; colliders: RAPIER.Collider[] } {
  const group = new THREE.Group();
  const colliders: RAPIER.Collider[] = [];
  const solid = parts.filter((p) => !p.visualOnly);
  const totalVol = solid.reduce((a, p) => a + shapeVolume(p.shape), 0) || 1;
  for (const p of parts) {
    group.add(meshFor(p));
    if (p.visualOnly) continue;
    const desc = colliderDesc(shrinkShape(p.shape, opts.core ?? 1))
      .setTranslation(...(p.pos ?? [0, 0, 0]))
      .setRotation(partRotation(p))
      .setMass((opts.mass * shapeVolume(p.shape)) / totalVol)
      .setFriction(opts.friction)
      .setRestitution(opts.restitution)
      .setCollisionGroups(opts.groups);
    colliders.push(world.createCollider(desc, body));
  }
  return { group, colliders };
}

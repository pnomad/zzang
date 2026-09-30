import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export const DT = 1 / 120;

// 충돌 그룹: (소속 << 16) | 충돌 대상
const STATIC = 1, PRIZE = 2, CLAW = 4;
const groups = (member: number, filter: number) => (member << 16) | filter;
export const GROUP_STATIC = groups(STATIC, PRIZE | CLAW);
export const GROUP_PRIZE = groups(PRIZE, STATIC | PRIZE | CLAW);
export const GROUP_CLAW = groups(CLAW, STATIC | PRIZE);
export const GROUP_NONE = groups(0, 0);

export function createWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = 8;
  world.integrationParameters.lengthUnit = 0.1;
  return world;
}

/** 물리 강체와 화면 오브젝트를 짝지어 매 프레임 동기화. 리플레이 기록 단위이기도 하다. */
export interface Synced {
  body: RAPIER.RigidBody;
  obj: THREE.Object3D;
}

export function syncObject(s: Synced) {
  const t = s.body.translation();
  const r = s.body.rotation();
  s.obj.position.set(t.x, t.y, t.z);
  s.obj.quaternion.set(r.x, r.y, r.z, r.w);
}

export const toQuat = (r: { x: number; y: number; z: number; w: number }) =>
  new THREE.Quaternion(r.x, r.y, r.z, r.w);
export const toVec = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

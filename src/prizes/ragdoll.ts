import * as THREE from 'three';
import { RAPIER, GROUP_PRIZE, type Synced } from '../physics/world';
import { attachParts, resizeCollider, shrinkShape, type Shape, type V3 } from '../physics/parts';
import { PRIZES, type PrizeDef } from './shapes';
import type { PrizeKind } from '../machine/settings';

/** 경품 하나 = 몸통 강체 + 스프링 관절로 연결된 부위(팔/귀/고리) 강체들 */
export interface Prize {
  id: number;
  def: PrizeDef;
  main: RAPIER.RigidBody;
  bodies: RAPIER.RigidBody[];
  colliders: RAPIER.Collider[];
  synced: Synced[];
  won: boolean;
  /** 눌린 정도: 1 = 원래 크기, 작을수록 찌그러짐 (인형만) */
  squish: number;
  /** 마지막으로 눌린 뒤 남은 시간 (접촉이 잠깐 끊겨도 눌린 채로 둔다) */
  pressHold: number;
  /** 찌그러질 때 크기를 바꿀 몸통 충돌체들과 원래 모양 */
  squishParts: { col: RAPIER.Collider; shape: Shape; pos: V3 }[];
  /** 몸통에 붙은 부위 관절 (찌그러지면 관절 위치도 당긴다) */
  joints: { joint: RAPIER.ImpulseJoint; anchor: V3 }[];
}

let nextId = 1;

/** 인형 속심 비율: 겉 솜 두께만큼 발이 파고든다 */
export const PLUSH_CORE = 0.8;

export function spawnPrize(
  world: RAPIER.World,
  scene: THREE.Object3D,
  kind: PrizeKind,
  pos: THREE.Vector3,
  rot: THREE.Quaternion,
): Prize {
  const def = PRIZES[kind];
  const color = def.colors[Math.floor(Math.random() * def.colors.length)];
  const { parts, limbs } = def.build(color);
  const limbMass = limbs.reduce((a, l) => a + l.massRatio * def.mass, 0);
  const common = {
    friction: def.friction, restitution: def.restitution, groups: GROUP_PRIZE,
    core: def.category === 'plush' ? PLUSH_CORE : 1,
  };

  const main = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
      .setLinearDamping(0.1)
      .setAngularDamping(0.3)
      .setCcdEnabled(def.size < 0.05),
  );
  const m = attachParts(world, main, parts, { ...common, mass: def.mass - limbMass });
  scene.add(m.group);

  const solid = parts.filter((p) => !p.visualOnly);
  const prize: Prize = {
    id: nextId++, def, main, bodies: [main], colliders: [...m.colliders],
    synced: [{ body: main, obj: m.group }], won: false,
    squish: 1,
    pressHold: 0,
    squishParts: m.colliders.map((col, i) => ({ col, shape: shrinkShape(solid[i].shape, common.core), pos: solid[i].pos ?? [0, 0, 0] })),
    joints: [],
  };

  for (const limb of limbs) {
    const anchorWorld = new THREE.Vector3(...limb.anchor).applyQuaternion(rot).add(pos);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(anchorWorld.x, anchorWorld.y, anchorWorld.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
        .setAngularDamping(0.5),
    );
    const l = attachParts(world, body, limb.parts, { ...common, mass: limb.massRatio * def.mass });
    scene.add(l.group);
    const axis = new THREE.Vector3(...limb.axis);
    const jd = RAPIER.JointData.revolute(
      { x: limb.anchor[0], y: limb.anchor[1], z: limb.anchor[2] },
      { x: 0, y: 0, z: 0 },
      { x: axis.x, y: axis.y, z: axis.z },
    );
    const joint = world.createImpulseJoint(jd, main, body, true) as RAPIER.RevoluteImpulseJoint;
    joint.setContactsEnabled(false);
    joint.setLimits(limb.limits[0], limb.limits[1]);
    joint.configureMotorPosition(0, limb.stiffness, limb.damping);
    prize.joints.push({ joint, anchor: limb.anchor });
    prize.bodies.push(body);
    prize.colliders.push(...l.colliders);
    prize.synced.push({ body, obj: l.group });
  }
  return prize;
}

export function removePrize(world: RAPIER.World, scene: THREE.Object3D, p: Prize) {
  for (const s of p.synced) scene.remove(s.obj);
  // 관절이 붙은 부위부터 제거
  for (let i = p.bodies.length - 1; i >= 0; i--) world.removeRigidBody(p.bodies[i]);
}

/** 경품 무게중심 (모든 강체 질량 가중 평균) */
export function prizeCenterOfMass(p: Prize): THREE.Vector3 {
  const c = new THREE.Vector3();
  let total = 0;
  for (const b of p.bodies) {
    const m = b.mass();
    const t = b.worldCom();
    c.x += t.x * m; c.y += t.y * m; c.z += t.z * m;
    total += m;
  }
  return c.divideScalar(total || 1);
}

/** 인형을 k배로 찌그러뜨린다 (몸통 충돌체·겉모습·부위 관절 위치를 같이) */
export function setSquish(p: Prize, k: number) {
  // 조금씩 바뀔 때는 건너뛰되, 원래 크기로 돌아가는 마지막 한 번은 꼭 적용한다
  if (k === p.squish || (Math.abs(k - p.squish) < 0.004 && k !== 1)) return;
  p.squish = k;
  for (const sp of p.squishParts) resizeCollider(sp.col, sp.shape, sp.pos, k);
  p.synced[0].obj.scale.setScalar(k);
  for (const j of p.joints) j.joint.setAnchor1({ x: j.anchor[0] * k, y: j.anchor[1] * k, z: j.anchor[2] * k });
  p.main.wakeUp();
}

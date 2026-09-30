import * as THREE from 'three';
import { RAPIER, GROUP_CLAW, type Synced, toQuat, toVec } from '../physics/world';
import { attachParts, type Part, type V3 } from '../physics/parts';
import type { MachineGeometry, MachineSettings } from './settings';

interface Finger {
  body: RAPIER.RigidBody;
  axis: THREE.Vector3; // 집게 본체 기준 경첩 축 (접선 방향)
}

/**
 * 3발 집게.
 *  트롤리(키네매틱) ─구면관절─ 줄(가상 강체) ─직선관절(한계=줄 길이)─ 본체 ─경첩×3─ 발
 * 직선관절의 상한만 줄 길이로 두기 때문에 줄은 당기기만 하고 밀지 못한다 (실제 와이어처럼).
 * 발은 모터 대신 직접 토크를 주고 최대 토크를 "집게 힘"으로 제한한다 (솔레노이드 전압 세팅).
 */
export class Claw {
  readonly trolley: RAPIER.RigidBody;
  readonly cable: RAPIER.RigidBody;
  readonly hub: RAPIER.RigidBody;
  readonly fingers: Finger[] = [];
  readonly synced: Synced[] = [];
  readonly colliderHandles = new Set<number>();
  readonly fingerColliderHandles = new Set<number>();
  private readonly winch: RAPIER.PrismaticImpulseJoint;

  readonly L: number;
  readonly hubR: number;
  readonly hubHH: number;
  readonly lMin: number;
  readonly lMaxAbs: number;
  readonly pivotY: number;

  private readonly fullTorque: number;
  private readonly kp: number;
  private readonly kd: number;
  private readonly openAngle: number;
  private readonly swingStiff: number;
  private readonly hangMass: number;
  private cableLength: number;
  /** 집게가 향할 방향 (수직축 회전, rad). 레버를 돌리면 조금씩 바뀐다 */
  targetYaw = 0;

  /** 현재 명령: 닫기 여부와 힘(0~1) */
  closing = false;
  power = 0;
  /** 마지막 스텝에 발 하나가 낸 평균 토크 비율 (HUD 표시용) */
  appliedRatio = 0;

  private cableLine: THREE.Line;
  /** 벌어지려는 복귀 스프링 토크 (최대 토크 대비 비율) */
  static readonly SPRING = 0.12;

  constructor(
    private world: RAPIER.World,
    private scene: THREE.Object3D,
    g: MachineGeometry,
    s: MachineSettings,
    home: THREE.Vector2,
  ) {
    const L = (this.L = g.prongLength * s.prongScale);
    const sc = g.prongLength / 0.13; // 본체 크기는 기계 크기에 비례
    this.hubR = 0.05 * sc;
    this.hubHH = 0.035 * sc;
    this.pivotY = g.height;
    this.lMin = 0.06 * sc;
    this.lMaxAbs = g.height - 2 * this.hubHH - 0.8 * L;
    this.cableLength = this.lMin;
    this.fullTorque = g.fullTorque * (L / g.prongLength); // 발이 길면 같은 힘에 토크가 커짐
    this.openAngle = THREE.MathUtils.degToRad(s.openAngleDeg);
    this.swingStiff = g.swingStiff;
    this.hangMass = g.hubMass + 3 * g.fingerMass;

    const fingerInertia = g.fullTorque / 120;
    this.kp = g.fullTorque / 0.08;
    this.kd = 2 * Math.sqrt(this.kp * fingerInertia);

    // 트롤리
    this.trolley = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(home.x, this.pivotY, home.y),
    );

    // 줄 (충돌체 없는 가상 강체)
    const cableMass = g.hubMass * 0.15;
    const ci = cableMass * 0.02 * sc * sc;
    this.cable = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(home.x, this.pivotY, home.y)
        .setAdditionalMassProperties(cableMass, { x: 0, y: 0, z: 0 }, { x: ci, y: ci, z: ci }, { x: 0, y: 0, z: 0, w: 1 })
        .setAngularDamping(s.swingDamping)
        .setCanSleep(false),
    );
    world.createImpulseJoint(
      RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }),
      this.trolley, this.cable, true,
    );

    // 본체
    const hubY = this.pivotY - this.lMin - this.hubHH;
    this.hub = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(home.x, hubY, home.y).setCanSleep(false),
    );
    const hubParts: Part[] = [
      { shape: { type: 'cylinder', hh: this.hubHH, r: this.hubR }, color: 0xd9dde2, mat: 'metal' },
      { shape: { type: 'cylinder', hh: this.hubHH * 0.5, r: this.hubR * 0.5 }, pos: [0, this.hubHH * 1.4, 0], color: 0x9aa1a9, mat: 'metal', visualOnly: true },
      { shape: { type: 'cylinder', hh: this.hubHH * 0.3, r: this.hubR * 1.05 }, pos: [0, -this.hubHH * 0.7, 0], color: 0xe8356f, mat: 'plastic', visualOnly: true },
    ];
    const hubBuilt = attachParts(world, this.hub, hubParts, {
      mass: g.hubMass, friction: 0.5, restitution: 0.05, groups: GROUP_CLAW,
    });
    scene.add(hubBuilt.group);
    this.synced.push({ body: this.hub, obj: hubBuilt.group });
    hubBuilt.colliders.forEach((c) => this.colliderHandles.add(c.handle));

    this.winch = world.createImpulseJoint(
      RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: this.hubHH, z: 0 }, { x: 0, y: -1, z: 0 }),
      this.cable, this.hub, true,
    ) as RAPIER.PrismaticImpulseJoint;
    this.winch.setLimits(0.005, this.cableLength);

    // 발 3개
    const rH = this.hubR * 0.85;
    const t = 0.05 * L;
    for (let i = 0; i < 3; i++) {
      const phi = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const radial = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi));
      const axis = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi));
      const hinge = new THREE.Vector3(rH * radial.x, -this.hubHH, rH * radial.z);
      const toBody = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -phi);
      const canon: Part[] = g.clawStyle === 'wire' ? wireFinger(L) : [
        { shape: { type: 'cuboid', hx: t, hy: 0.3 * L, hz: t * 1.6 }, pos: [0, -0.3 * L, 0] },
        { shape: { type: 'cuboid', hx: t, hy: 0.225 * L, hz: t * 1.4 }, pos: [-0.145 * L, -0.772 * L, 0], rot: [0, 0, -0.7] },
        { shape: { type: 'ball', r: t * 1.4 }, pos: [-0.29 * L, -0.945 * L, 0] },
      ];
      const parts: Part[] = canon.map((p) => {
        const pos = new THREE.Vector3(...(p.pos ?? [0, 0, 0])).applyQuaternion(toBody);
        const q = toBody.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))));
        const e = new THREE.Euler().setFromQuaternion(q);
        return { ...p, pos: pos.toArray() as V3, rot: [e.x, e.y, e.z] as V3, color: 0xc8ccd2, mat: 'metal' as const };
      });
      const hw = hinge.clone().add(new THREE.Vector3(home.x, hubY, home.y));
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(hw.x, hw.y, hw.z)
          .setAdditionalMassProperties(1e-4, { x: 0, y: 0, z: 0 },
            { x: fingerInertia, y: fingerInertia, z: fingerInertia }, { x: 0, y: 0, z: 0, w: 1 })
          .setAngularDamping(1)
          .setCanSleep(false),
      );
      const built = attachParts(world, body, parts, {
        mass: g.fingerMass, friction: 0.6, restitution: 0.02, groups: GROUP_CLAW,
      });
      scene.add(built.group);
      built.colliders.forEach((c) => {
        this.colliderHandles.add(c.handle);
        this.fingerColliderHandles.add(c.handle);
      });
      const joint = world.createImpulseJoint(
        RAPIER.JointData.revolute(
          { x: hinge.x, y: hinge.y, z: hinge.z }, { x: 0, y: 0, z: 0 },
          { x: axis.x, y: axis.y, z: axis.z },
        ),
        this.hub, body, true,
      ) as RAPIER.RevoluteImpulseJoint;
      joint.setContactsEnabled(false);
      joint.setLimits(-0.12, this.openAngle + 0.05);
      this.fingers.push({ body, axis });
      this.synced.push({ body, obj: built.group });
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.cableLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x333333 }));
    this.cableLine.frustumCulled = false;
    scene.add(this.cableLine);
  }

  get length() { return this.cableLength; }

  setLength(l: number) {
    this.cableLength = THREE.MathUtils.clamp(l, this.lMin, this.lMaxAbs);
    this.winch.setLimits(0.005, this.cableLength);
  }

  setTrolley(x: number, z: number) {
    this.trolley.setNextKinematicTranslation({ x, y: this.pivotY, z });
  }

  /** 트롤리 ~ 본체 윗면 실제 거리 (줄이 늘어져 있으면 설정 길이보다 짧다) */
  actualLength(): number {
    const top = new THREE.Vector3(0, this.hubHH, 0).applyQuaternion(toQuat(this.hub.rotation())).add(toVec(this.hub.translation()));
    return top.distanceTo(toVec(this.trolley.translation()));
  }

  /** 줄이 수직에서 벗어난 각도 (rad) */
  swingAngle(): number {
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(toQuat(this.cable.rotation()));
    return down.angleTo(new THREE.Vector3(0, -1, 0));
  }

  fingerAngle(f: Finger, qHubInv: THREE.Quaternion): number {
    const rel = qHubInv.clone().multiply(toQuat(f.body.rotation()));
    const s = rel.x * f.axis.x + rel.y * f.axis.y + rel.z * f.axis.z;
    let a = 2 * Math.atan2(s, rel.w);
    if (a > Math.PI) a -= 2 * Math.PI;
    if (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /**
   * 미니 기계: 짧은 줄에 거의 고정된 집게처럼, 줄을 수직으로 되돌리는 힘(+감쇠)을 준다.
   * 갠트리가 급하게 서도 기울기가 1~2° 안에서 바로 잡힌다.
   */
  private holdVertical() {
    if (this.swingStiff <= 0) return;
    const down = new THREE.Vector3(0, -1, 0);
    const d = down.clone().applyQuaternion(toQuat(this.cable.rotation()));
    const len = this.cableLength + this.hubHH;
    const k = this.swingStiff * this.hangMass * 9.81 * len;
    const inertia = this.hangMass * len * len;
    // 줄 방향을 수직으로 돌리는 축 × 기울기(sin), 줄 축 둘레의 회전은 건드리지 않는다
    const w = toVec(this.cable.angvel());
    const wSwing = w.sub(d.clone().multiplyScalar(w.dot(d)));
    const tau = d.clone().cross(down).multiplyScalar(k).addScaledVector(wSwing, -2 * Math.sqrt(k * inertia));
    this.cable.addTorque(tau, true);
  }

  /** 집게(본체+발)의 무게 (N): 경품 위에 얹혀 누르는 힘 */
  get weight() { return this.hangMass * 9.81; }

  /** 줄이 느슨함 = 집게가 무언가 위에 얹혀 자기 무게로 누르는 중 */
  get resting() { return this.cableLength - this.actualLength() > this.L * 0.05; }

  /** 집게가 지금 향한 방향 (수직축 회전, rad) */
  yaw(): number {
    const v = new THREE.Vector3(1, 0, 0).applyQuaternion(toQuat(this.hub.rotation()));
    return Math.atan2(-v.z, v.x);
  }

  /** 레버를 돌릴 때 집게 방향을 조금 돌린다 */
  twist(delta: number) {
    this.targetYaw = THREE.MathUtils.clamp(this.targetYaw + delta, -Math.PI / 2, Math.PI / 2);
  }

  /** 집게가 목표 방향으로 천천히 돌아가게 (줄 꼬임처럼 살짝 출렁이며) */
  private holdYaw() {
    const inertia = this.hangMass * this.hubR * this.hubR * 0.6;
    const k = inertia * (Math.PI * 2 / 0.6) ** 2;
    let err = this.targetYaw - this.yaw();
    err = Math.atan2(Math.sin(err), Math.cos(err));
    const tau = k * err - 2 * Math.sqrt(k * inertia) * 0.6 * this.cable.angvel().y;
    this.cable.addTorque({ x: 0, y: tau, z: 0 }, true);
  }

  /** 매 물리 스텝 전에 호출: 발 토크 적용 */
  preStep() {
    // 줄에 주는 힘은 매 스텝 새로 계산한다 (Rapier는 힘을 지우기 전까지 계속 준다)
    this.cable.resetTorques(false);
    this.holdVertical();
    this.holdYaw();
    const qHub = toQuat(this.hub.rotation());
    const qInv = qHub.clone().invert();
    const wHub = toVec(this.hub.angvel());
    this.hub.resetTorques(false);
    const hubTorque = new THREE.Vector3();
    let ratioSum = 0;
    for (const f of this.fingers) {
      const axisW = f.axis.clone().applyQuaternion(qHub);
      const angle = this.fingerAngle(f, qInv);
      const wRel = toVec(f.body.angvel()).sub(wHub).dot(axisW);
      let target: number, tMax: number;
      if (this.closing) {
        target = -0.5;
        tMax = this.power * this.fullTorque;
      } else {
        target = this.openAngle;
        tMax = 0.6 * this.fullTorque;
      }
      let tau = THREE.MathUtils.clamp(this.kp * (target - angle) - this.kd * wRel, -tMax, tMax);
      // 복귀 스프링: 실제 집게는 항상 벌어지려는 스프링이 있어서, 전압(힘)이 약하면 발이 헐거워진다
      if (this.closing) tau += Claw.SPRING * this.fullTorque;
      if (this.closing) ratioSum += Math.max(0, -tau) / this.fullTorque;
      f.body.resetTorques(false);
      f.body.addTorque(axisW.clone().multiplyScalar(tau), true);
      hubTorque.addScaledVector(axisW, -tau);
    }
    this.hub.addTorque(hubTorque, true);
    this.appliedRatio = ratioSum / 3;
  }

  sync() {
    const p = this.trolley.translation();
    const top = new THREE.Vector3(0, this.hubHH * 1.9, 0).applyQuaternion(toQuat(this.hub.rotation())).add(toVec(this.hub.translation()));
    const attr = this.cableLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, p.x, p.y, p.z);
    attr.setXYZ(1, top.x, top.y, top.z);
    attr.needsUpdate = true;
  }

  /** 리플레이 재생 중 줄 표시 */
  syncCableFromObjects(trolley: THREE.Vector3) {
    const hubObj = this.synced[0].obj;
    const top = new THREE.Vector3(0, this.hubHH * 1.9, 0).applyQuaternion(hubObj.quaternion).add(hubObj.position);
    const attr = this.cableLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, trolley.x, trolley.y, trolley.z);
    attr.setXYZ(1, top.x, top.y, top.z);
    attr.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.cableLine);
    for (const s of this.synced) this.scene.remove(s.obj);
    void this.world;
  }
}

/**
 * 미니 기계의 가는 철사 집게 발: 경첩에서 아래로 내려가며 바깥으로 살짝 휘었다가 끝이 안쪽(-x)으로 굽는다.
 * 곡선을 따라 짧은 캡슐을 이어 만든다 (겉모습과 충돌 모양이 같다).
 */
function wireFinger(L: number): Part[] {
  const r = 0.028 * L;
  const pt = (u: number) => new THREE.Vector2(0.1 * L * Math.sin(Math.PI * u * 0.8) - 0.4 * L * u ** 4, -0.97 * L * u);
  const parts: Part[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = pt(i / n), b = pt((i + 1) / n);
    const d = b.clone().sub(a);
    const len = d.length();
    parts.push({
      shape: { type: 'capsule', hh: len / 2, r },
      pos: [(a.x + b.x) / 2, (a.y + b.y) / 2, 0],
      rot: [0, 0, Math.atan2(-d.x, d.y)],
    });
  }
  // 경첩 쪽 받침판
  parts.push({ shape: { type: 'cuboid', hx: r * 1.4, hy: 0.06 * L, hz: r * 2.5 }, pos: [0, -0.04 * L, 0] });
  return parts;
}

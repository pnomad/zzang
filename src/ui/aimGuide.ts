import * as THREE from 'three';
import { RAPIER, GROUP_CLAW } from '../physics/world';
import type { Rig } from '../game/rig';

/**
 * 연습용 조준 도우미: 집게 바로 아래 경품(또는 바닥) 윗면에 집게가 벌어졌을 때의 범위를 원으로 표시한다.
 * 실제 기계에는 없는 기능이라 실전 모드에서는 끈다.
 */
export class AimGuide {
  private group = new THREE.Group();
  private ring: THREE.Mesh;
  private dot: THREE.Mesh;
  private line: THREE.Line;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x47d7ff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), mat);
    this.ring.rotation.x = -Math.PI / 2;
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(1, 16), mat);
    this.dot.rotation.x = -Math.PI / 2;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({
      color: 0x47d7ff, dashSize: 0.01, gapSize: 0.008, transparent: true, opacity: 0.6, depthTest: false,
    }));
    this.line.frustumCulled = false;
    for (const o of [this.ring, this.dot, this.line]) o.renderOrder = 998;
    this.group.add(this.ring, this.dot, this.line);
    this.group.visible = false;
    scene.add(this.group);
  }

  /** 표시는 기계 로컬 좌표로 계산하므로 지금 플레이 중인 기계 그룹에 붙인다 */
  setParent(parent: THREE.Object3D) {
    parent.add(this.group);
  }

  update(rig: Rig, show: boolean) {
    this.group.visible = show;
    if (!show) return;
    const claw = rig.claw;
    const t = claw.trolley.translation();
    const hubY = claw.hub.translation().y - claw.hubHH - claw.L;
    const ray = new RAPIER.Ray({ x: t.x, y: hubY, z: t.z }, { x: 0, y: -1, z: 0 });
    // 집게와 같은 충돌 그룹으로 쏘면 집게 자신은 맞지 않고 경품·바닥만 맞는다
    const hit = rig.world.castRay(ray, 5, true, undefined, GROUP_CLAW);
    const y = hit ? hubY - hit.timeOfImpact : 0;
    // 배출구 위에서는 바닥이 한참 아래라 표시하지 않는다
    if (y < -0.01) { this.group.visible = false; return; }
    const surf = y + 0.002;
    // 벌어진 발끝이 그리는 원의 반지름 (대략)
    const r = claw.hubR * 0.85 + claw.L * 0.9 * Math.sin(THREE.MathUtils.degToRad(rig.settings.openAngleDeg));
    this.ring.position.set(t.x, surf, t.z);
    this.ring.scale.setScalar(r);
    this.dot.position.set(t.x, surf, t.z);
    this.dot.scale.setScalar(claw.L * 0.05);
    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.setXYZ(0, t.x, hubY, t.z);
    attr.setXYZ(1, t.x, surf, t.z);
    attr.needsUpdate = true;
    this.line.computeLineDistances();
  }
}

import * as THREE from 'three';
import { RAPIER, GROUP_STATIC } from '../physics/world';
import { material } from '../physics/parts';
import type { MachineGeometry, MachineSettings } from './settings';

/**
 * 좌표계: Y 위, 경품 바닥 윗면 y=0, 앞(플레이어 쪽) = +Z.
 * 배출구는 앞-왼쪽 모서리. 배출구로 떨어져 y < BIN_SUCCESS_Y 가 되면 성공.
 */
export interface Cabinet {
  chuteCenter: THREE.Vector2; // x, z
  chuteMin: THREE.Vector2;
  chuteMax: THREE.Vector2;
  binY: number;
  bottomY: number;            // 캐비닛 맨 아래 (받침 바닥) 높이
  outerSize: THREE.Vector2;   // 외곽 가로·세로 (조작 패널 포함)
  successY: number;
  group: THREE.Group;
  bridge: THREE.Object3D;     // 갠트리 (z 이동)
  carriage: THREE.Object3D;   // 캐리지 (x 이동)
}

export function buildCabinet(
  world: RAPIER.World,
  scene: THREE.Object3D,
  g: MachineGeometry,
  s: MachineSettings,
): Cabinet {
  const group = new THREE.Group();
  scene.add(group);
  const W = g.width, D = g.depth, H = g.height, C = g.chuteSize;
  const binY = -Math.max(0.2, H * 0.35);
  const sc = W / 0.8;

  const staticBox = (
    hx: number, hy: number, hz: number, x: number, y: number, z: number,
    look: THREE.Material | null, friction = 0.6,
  ) => {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z)
        .setFriction(friction).setCollisionGroups(GROUP_STATIC),
    );
    if (look) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), look);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      m.castShadow = look.transparent !== true;
      group.add(m);
    }
  };

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.85 });
  const glassMat = material('clear', 0xddeeff);
  (glassMat as THREE.MeshPhysicalMaterial).opacity = 0.1;
  const acrylMat = new THREE.MeshPhysicalMaterial({
    color: 0xaad8ff, transparent: true, opacity: 0.3, roughness: 0.05, depthWrite: false,
  });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8356f, roughness: 0.45 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b24, roughness: 0.6 });
  const chromeMat = material('metal', 0xcfd4da);

  const t = 0.02; // 바닥/벽 두께의 절반
  const x0 = -W / 2, z1 = D / 2;

  // 경품 바닥 (배출구 부분이 뚫린 2조각)
  staticBox(W / 2, t, (D - C) / 2, 0, -t, -C / 2, floorMat, 0.7);
  staticBox((W - C) / 2, t, C / 2, x0 + C + (W - C) / 2, -t, z1 - C / 2, floorMat, 0.7);
  // 보이는 바닥판은 얇지만, 충돌판은 아래로 두껍게 둔다 (경품이 바닥에 파묻혔다 밀려날 때 아래로 빠지지 않게)
  const ft = 0.15;
  staticBox(W / 2, ft, (D - C) / 2, 0, -2 * t - ft, -C / 2, null, 0.7);
  staticBox((W - C) / 2, ft, C / 2, x0 + C + (W - C) / 2, -2 * t - ft, z1 - C / 2, null, 0.7);

  // 외벽 (유리)
  const wallBottom = binY - 0.05;
  const fullH = (H - wallBottom) / 2;
  // 충돌체는 바깥쪽으로 두껍게 (팔·귀 같은 가벼운 부위가 얇은 벽을 뚫고 나가 걸리지 않도록)
  const wt = 0.1;
  const wy = wallBottom + fullH;
  staticBox(wt, fullH, D / 2 + 2 * wt, x0 - wt, wy, 0, null);
  staticBox(wt, fullH, D / 2 + 2 * wt, W / 2 + wt, wy, 0, null);
  staticBox(W / 2 + 2 * wt, fullH, wt, 0, wy, -D / 2 - wt, null);
  staticBox(W / 2 + 2 * wt, fullH, wt, 0, wy, z1 + wt, null);
  const glass = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, fullH * 2, d), glassMat);
    m.position.set(x, wy, z);
    group.add(m);
  };
  glass(0.006, D, x0 - 0.003, 0);
  glass(0.006, D, W / 2 + 0.003, 0);
  glass(W, 0.006, 0, -D / 2 - 0.003);
  glass(W, 0.006, 0, z1 + 0.003);

  // 배출구 가드 (투명 아크릴, 플레이 영역 쪽 두 면)
  const gh = s.guardHeight / 2;
  const gt = 0.004;
  staticBox(gt, gh, C / 2, x0 + C, gh, z1 - C / 2, acrylMat, 0.3);
  staticBox(C / 2, gh, gt, x0 + C / 2, gh, z1 - C, acrylMat, 0.3);
  // 가드 윗면 테두리
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, C), chromeMat);
  rim.position.set(x0 + C, s.guardHeight, z1 - C / 2);
  group.add(rim);
  const rim2 = new THREE.Mesh(new THREE.BoxGeometry(C, 0.006, 0.006), chromeMat);
  rim2.position.set(x0 + C / 2, s.guardHeight, z1 - C);
  group.add(rim2);

  // 배출구 통로 벽 (바닥 아래)
  const shaftH = -binY / 2;
  staticBox(gt, shaftH, C / 2, x0 + C, -shaftH, z1 - C / 2, darkMat);
  staticBox(C / 2, shaftH, gt, x0 + C / 2, -shaftH, z1 - C, darkMat);
  // 받는 통 바닥
  staticBox(C / 2, t, C / 2, x0 + C / 2, binY - t, z1 - C / 2, darkMat);

  // ---- 외관 (충돌 없음) ----
  const post = (x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.04 * sc, H - binY + 0.3 * sc, 0.04 * sc), bodyMat);
    m.position.set(x, (H + binY - 0.3 * sc) / 2 + 0.1 * sc, z);
    m.castShadow = true;
    group.add(m);
  };
  const px = W / 2 + 0.04 * sc, pz = D / 2 + 0.04 * sc;
  post(-px, -pz); post(px, -pz); post(-px, pz); post(px, pz);

  // 하단 받침 (배출구 아래 캐비닛)
  const baseH = 0.6 * sc;
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12 * sc, baseH, D + 0.12 * sc), bodyMat);
  base.position.set(0, binY - 0.05 - baseH / 2, 0);
  base.receiveShadow = true;
  group.add(base);
  // 경품 꺼내는 문
  const door = new THREE.Mesh(new THREE.BoxGeometry(C * 0.9, C * 0.6, 0.01), darkMat);
  door.position.set(x0 + C / 2, binY - 0.05 - C * 0.35, D / 2 + 0.061 * sc);
  group.add(door);
  // 조작 패널
  const panel = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12 * sc, 0.04 * sc, 0.16 * sc), trimMat);
  panel.position.set(0, binY - 0.03, D / 2 + 0.12 * sc);
  group.add(panel);
  // 천장 박스 + 간판
  const topH = 0.18 * sc;
  const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12 * sc, topH, D + 0.12 * sc), bodyMat);
  top.position.set(0, H + 0.03 + topH / 2, 0);
  group.add(top);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.9, topH * 0.8),
    new THREE.MeshBasicMaterial({ map: signTexture(s.kind === 'mini' ? '미니뽑기' : '인형뽑기') }),
  );
  sign.position.set(0, H + 0.03 + topH / 2, D / 2 + 0.061 * sc);
  group.add(sign);
  // 조명 (천장 LED)
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.9, 0.008, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xfff6d5 }),
  );
  led.position.set(0, H + 0.02, D / 2 - 0.03);
  group.add(led);

  // 갠트리 레일 + 브리지 + 캐리지
  for (const x of [x0 + 0.01, W / 2 - 0.01]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.015 * sc, 0.015 * sc, D), chromeMat);
    rail.position.set(x, H + 0.01, 0);
    group.add(rail);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(W, 0.02 * sc, 0.03 * sc), chromeMat);
  bridge.position.y = H + 0.01;
  group.add(bridge);
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.07 * sc, 0.04 * sc, 0.07 * sc), darkMat);
  carriage.position.y = H + 0.005;
  group.add(carriage);

  return {
    chuteCenter: new THREE.Vector2(x0 + C / 2, z1 - C / 2),
    chuteMin: new THREE.Vector2(x0, z1 - C),
    chuteMax: new THREE.Vector2(x0 + C, z1),
    binY,
    bottomY: binY - 0.05 - baseH,
    outerSize: new THREE.Vector2(W + 0.12 * sc, D + 0.12 * sc + 0.2 * sc),
    successY: -0.03,
    group, bridge, carriage,
  };
}

function signTexture(text: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, '#ff4d8d');
  grad.addColorStop(1, '#ffb347');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = '#fff';
  g.font = 'bold 76px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 8;
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

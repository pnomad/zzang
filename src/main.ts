import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RAPIER, DT } from './physics/world';
import { PRESETS, cloneSettings, randomizeForRealMode, type MachineSettings } from './machine/settings';
import { Controller, type Input } from './game/controller';
import type { AttemptResult, Phase } from './game/analysis';
import { prizeCenterOfMass } from './prizes/ragdoll';
import { Hud, type Stats, type HoldKey } from './ui/hud';
import { Panel, type PanelState } from './ui/panel';
import { Sound } from './ui/sound';
import { AimGuide } from './ui/aimGuide';
import { buildRoom, createMachines, type ArcadeMachine } from './lobby/arcade';
import { Lobby2D } from './lobby/lobby2d';

await RAPIER.init();

// ---------- 렌더러 / 씬 ----------
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x201a2b);
// 금속/플라스틱 반사용 환경맵
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;
scene.add(new THREE.HemisphereLight(0xfff4f8, 0x3a2f4a, 0.8));
// 그림자를 만드는 해: 오락실에서는 캐릭터 주변을 넓게, 기계 안에서는 그 기계만 선명하게 비춘다
const SUN_OFFSET = new THREE.Vector3(0.6, 2.2, 1.4);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
// 플레이 중인 기계 안의 천장 조명 (조명 개수가 바뀌면 셰이더를 다시 만들어야 하므로 하나를 옮겨 쓴다)
const machineLamp = new THREE.PointLight(0xfff2d0, 0, 3, 1.5);
scene.add(machineLamp);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 40);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.enabled = false;

// ---------- 저장된 설정 ----------
const panelState: PanelState = { real: false, presetIndex: 0, showCom: false, showAim: true, showZone: true };
// 연습 모드 세팅은 기계마다 저장한다 (실전 모드 기계는 매번 새로 뽑으므로 저장하지 않음)
const SETTINGS_KEY = 'clawsim-settings-v8';
type Saved = { showCom: boolean; showAim: boolean; showZone: boolean; muted: boolean; machines: Record<string, MachineSettings> };
let saved: Partial<Saved> = {};
try {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) saved = JSON.parse(raw);
} catch { /* 저장소 사용 불가 */ }
panelState.showCom = !!saved.showCom;
panelState.showAim = saved.showAim ?? true;
panelState.showZone = saved.showZone ?? true;
const sound = new Sound(!!saved.muted);

function loadPractice(i: number): MachineSettings {
  const base = cloneSettings(PRESETS[i].settings);
  const sv = saved.machines?.[i];
  // 기계 종류가 같을 때만 복원 (예전 버전 저장값에 없는 항목은 프리셋 값 유지)
  if (!sv || sv.kind !== base.kind) return base;
  return { ...base, ...sv, prizeMix: { ...base.prizeMix, ...sv.prizeMix } };
}

// ---------- 오락실 ----------
buildRoom(scene);
const machines = createMachines(scene, loadPractice);
const saveSettings = () => {
  const saved: Record<string, MachineSettings> = {};
  for (const m of machines) saved[m.index] = m.practice;
  const sv: Saved = { showCom: panelState.showCom, showAim: panelState.showAim, showZone: panelState.showZone, muted: sound.muted, machines: saved };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(sv)); } catch { /* 무시 */ }
};

// ---------- 상태 ----------
type SceneMode = 'lobby' | 'play';
let sceneMode: SceneMode = 'lobby';
let cur: ArcadeMachine | null = null; // 플레이 중인 기계
let ctrl: Controller | null = null;
const input: Input = { right: false, up: false, left: false, down: false, drop: false };
const rigOf = () => cur!.rig!;
const active = () => cur!.settings;

type View = 'top' | 'front' | 'side' | 'free';
const VIEW_LABEL: Record<View, string> = { top: '위에서', front: '정면', side: '옆에서', free: '자유' };
let view: View = 'top';

const STATS_KEY = 'clawsim-stats-v1';
type AllStats = { practice: Stats; real: Stats };
let allStats: AllStats = { practice: { attempts: 0, wins: 0, spent: 0 }, real: { attempts: 0, wins: 0, spent: 0 } };
try {
  const raw = localStorage.getItem(STATS_KEY);
  if (raw) allStats = { ...allStats, ...JSON.parse(raw) };
} catch { /* 저장소 사용 불가 */ }
const saveStats = () => { try { localStorage.setItem(STATS_KEY, JSON.stringify(allStats)); } catch { /* 무시 */ } };
const curStats = () => (panelState.real ? allStats.real : allStats.practice);

const replay = { active: false, frame: 0, playing: true, speed: 0.5 };
let lastResult: AttemptResult | null = null;

// ---------- UI ----------
const hud = new Hud(document.getElementById('app')!, {
  coin: () => insertCoin(),
  // 집기는 누르는 순간 예약되고 물리 스텝이 읽은 뒤 지워진다 (짧게 톡 쳐도 유실되지 않게)
  hold: (k: HoldKey, down: boolean) => { if (k === 'drop') { if (down) input.drop = true; } else input[k] = down; },
  camera: () => cycleView(),
  replay: () => startReplay(),
  replayClose: () => exitReplay(),
  replaySeek: (f) => { replay.frame = f; replay.playing = false; },
  replayToggle: () => {
    if (!ctrl) return;
    if (replay.frame >= ctrl.recorder.length - 1) replay.frame = 0;
    replay.playing = !replay.playing;
  },
  replaySpeed: (s) => { replay.speed = s; },
  mute: () => toggleMute(),
  enter: () => enterNear(),
  leave: () => leaveMachine(),
});
hud.setMuted(sound.muted);

function toggleMute() {
  sound.setMuted(!sound.muted);
  hud.setMuted(sound.muted);
  saveSettings();
}

const panel = new Panel(machines[0].settings, panelState, {
  rebuild: () => rebuildCurrent(),
  refill: () => {
    if (!ctrl || ctrl.busy) return;
    exitReplay();
    rigOf().fillPrizes();
  },
  mode: (real) => setRealMode(real),
  reveal: () => revealSettings(),
  live: () => {
    if (!cur?.rig) return;
    cur.rig.claw.cable.setAngularDamping(active().swingDamping);
    updateZoneOverlay();
    hud.setControlMode(active().controlMode, active().price);
  },
  resetStats: () => {
    allStats[panelState.real ? 'real' : 'practice'] = { attempts: 0, wins: 0, spent: 0 };
    saveStats();
    hud.setStats(curStats());
  },
  changed: () => saveSettings(),
  resetSettings: () => {
    if (!cur) return;
    cur.practice = cloneSettings(cur.preset.settings);
    if (!panelState.real) cur.settings = cur.practice;
    panel.setSettings(cur.settings);
    rebuildCurrent();
    saveSettings();
  },
});
panel.setVisible(false);

function machineLabel(m: ArcadeMachine) {
  return panelState.real ? `${m.title} (세팅 비공개)` : m.preset.name;
}

// ---------- 오락실(2D) ↔ 기계(3D) ----------
const lobby = new Lobby2D(document.getElementById('app')!, machines);
let preparing = false;

function enterNear() {
  const m = lobby.near;
  if (sceneMode !== 'lobby' || !m || preparing) return;
  if (m.dirty || !m.rig) {
    // 처음 들어가는 기계는 경품을 가라앉히느라 잠깐 걸린다: 안내를 먼저 그리고 다음 프레임에 만든다
    preparing = true;
    hud.setLobbyStatus(machineLabel(m), '기계 준비 중…');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      m.build(panelState.real);
      preparing = false;
      enterMachine(m);
    }));
  } else enterMachine(m);
}

function enterMachine(m: ArcadeMachine) {
  cur = m;
  sceneMode = 'play';
  panelState.presetIndex = m.index;
  input.right = input.left = input.up = input.down = input.drop = false;
  for (const q of machines) q.group.visible = q === m;
  lobby.setVisible(false);
  panel.setSettings(m.settings);
  panel.setVisible(true);
  attachMachine();
  camSnap = true;
  hud.setStats(curStats());
}

/** 지금 기계에 컨트롤러·조준 표시·조명·카메라를 붙인다 (들어갈 때, 기계를 다시 만들었을 때) */
function attachMachine() {
  const m = cur!;
  const rig = m.rig!;
  exitReplay();
  hud.hideResult();
  lastResult = null;
  ctrl = new Controller(rig, m.payout);
  ctrl.onResult = onResult;
  aim.setParent(m.group);
  m.group.add(comLayer);
  updateZoneOverlay();
  const g = rig.geom;
  const sc = g.width / 0.8;
  machineLamp.position.copy(m.toWorld(new THREE.Vector3(0, g.height - 0.05, 0.1 * sc)));
  machineLamp.intensity = 1.5 * sc;
  machineLamp.distance = 3 * sc;
  hud.setControlMode(m.settings.controlMode, m.settings.price);
  hud.setMode(panelState.real, machineLabel(m));
  setShadowFocus(m.toWorld(new THREE.Vector3(0, g.height * 0.4, 0)), 0.9);
  applyView();
}

function leaveMachine() {
  if (sceneMode !== 'play' || !cur) return;
  if (ctrl?.busy) { hud.toast('이번 판이 끝나면 나갈 수 있어요'); return; }
  exitReplay();
  hud.hideResult();
  sceneMode = 'lobby';
  orbit.enabled = false;
  panel.setVisible(false);
  sound.motorOn(false);
  input.right = input.left = input.up = input.down = input.drop = false;
  lobby.placeAt(cur);
  lobby.setVisible(true);
  hud.showLobby();
  hud.setMode(panelState.real, '오락실');
}

function rebuildCurrent() {
  if (!cur || ctrl?.busy) return;
  cur.build(panelState.real);
  attachMachine();
}

/** 연습 ↔ 실전. 실전이면 모든 기계의 세팅을 새로 숨겨서 뽑는다 (다른 기계는 들어갈 때 다시 만든다) */
function setRealMode(real: boolean) {
  panelState.real = real;
  if (real && view === 'free') view = 'top';
  for (const m of machines) {
    m.settings = real ? randomizeForRealMode(m.practice) : m.practice;
    m.dirty = true;
  }
  lobby.refreshSigns(real);
  if (cur) {
    panel.setSettings(cur.settings);
    rebuildCurrent();
  }
  hud.setStats(curStats());
}

function insertCoin() {
  if (!ctrl) return;
  if (replay.active) exitReplay();
  hud.hideResult();
  if (!ctrl.start()) return;
  sound.play('coin');
  const st = curStats();
  st.attempts++;
  st.spent += active().price;
  saveStats();
  hud.setStats(st);
}

function onResult(r: AttemptResult) {
  lastResult = r;
  const st = curStats();
  if (r.success) st.wins++;
  st.causes = { ...st.causes, [r.cause]: (st.causes?.[r.cause] ?? 0) + 1 };
  saveStats();
  sound.play(r.success ? 'win' : 'fail');
  hud.setStats(curStats());
  hud.showResult(r, { real: panelState.real, hasReplay: ctrl!.recorder.length > 1, onAgain: insertCoin });
}

function revealSettings() {
  if (!cur) return;
  const s = cur.settings;
  const spread = s.payoutSpread ? ` ±${s.payoutSpread}%` : '';
  const t = cur.payout.target;
  const payoutText = s.payoutMode === 'everyN'
    ? `약 ${s.payoutN}판${spread}마다 강집게(${s.strongPower}%)${t ? `, 이번 주기는 ${t.plays}판째` : ''}`
    : s.payoutMode === 'amount'
      ? `약 ₩${s.payoutAmount.toLocaleString('ko-KR')}${spread} 쓸 때마다 강집게(${s.strongPower}%)${t ? `, 이번 주기는 ₩${t.amount.toLocaleString('ko-KR')}` : ''}`
      : '없음';
  const r: AttemptResult = {
    success: false, cause: 'miss', title: '이 기계의 실제 세팅', wonKinds: [], strongTurn: false, trace: [],
    detail: `집을 때 ${s.grabPower}% → 올라갈 때 ${s.liftPower}% → 꼭대기 ${s.topPower}% → 이동 중 ${s.returnPower}%`,
    tips: [
      `확률: ${payoutText}. 지금까지 강집게 없이 ${cur.payout.playsSinceWin}판 진행.`,
      `배출구 가드 높이 ${(s.guardHeight * 100).toFixed(1)}cm, 벌어짐 ${s.openAngleDeg}°, 하강 깊이 ${Math.round(s.dropDepth * 100)}%.`,
      '같은 세팅을 연습 모드로 옮기려면 연습 모드에서 위 숫자를 입력해 보세요.',
    ],
  };
  hud.showResult(r, { real: true, hasReplay: false, onAgain: insertCoin });
}

// ---------- 카메라 ----------
// 카메라는 목표 위치로 부드럽게 따라간다 (오락실 ↔ 기계 전환도 자연스럽게 이어지도록)
const camGoal = { pos: new THREE.Vector3(0, 2, 3), look: new THREE.Vector3(0, 1, 0) };
const camLook = new THREE.Vector3(0, 1, 0);
let camSnap = true;

function setShadowFocus(focus: THREE.Vector3, half: number) {
  const s = half / 0.9;
  sun.target.position.copy(focus);
  sun.position.copy(focus).addScaledVector(SUN_OFFSET, Math.max(1, s * 1.2));
  const c = sun.shadow.camera;
  c.left = -half; c.right = half; c.top = half; c.bottom = -half;
  c.updateProjectionMatrix();
}

/** 기계 앞 시점 (기계 로컬 좌표로 정하고 월드로 옮긴다) */
function applyView() {
  if (!cur?.rig) return;
  const g = cur.rig.geom;
  const sc = g.width / 0.8;
  const H = g.height;
  const W = (x: number, y: number, z: number) => cur!.toWorld(new THREE.Vector3(x, y, z));
  orbit.enabled = view === 'free';
  let pos: THREE.Vector3, look: THREE.Vector3;
  if (view === 'top') {
    // 기계 앞에 서서 유리 너머로 내려다보는 시점 (실제로 할 때 눈높이)
    // 세로 화면(휴대폰)에서는 기계 폭이 다 들어오도록 같은 방향으로 뒤로 물러난다
    const target = new THREE.Vector3(0, H * 0.2, -g.depth * 0.05);
    const back = camera.aspect < 1 ? Math.min(1.6, 0.6 / camera.aspect) : 1;
    const p = new THREE.Vector3(0, H * 1.35, g.depth / 2 + 0.7 * sc).sub(target).multiplyScalar(back).add(target);
    pos = W(p.x, p.y, p.z);
    look = W(target.x, target.y, target.z);
  } else if (view === 'front') {
    pos = W(0, H * 0.78, g.depth / 2 + 1.25 * sc + 0.12);
    look = W(0, H * 0.36, 0);
  } else if (view === 'side') {
    pos = W(g.width / 2 + 0.95 * sc + 0.1, H * 0.62, 0.02);
    look = W(0, H * 0.28, 0);
  } else {
    pos = W(0.5 * sc, H * 1.1, g.depth / 2 + 0.9 * sc);
    look = W(0, H * 0.3, 0);
    orbit.target.copy(look);
    camera.position.copy(pos);
    orbit.update();
  }
  camGoal.pos.copy(pos);
  camGoal.look.copy(look);
  hud.setCameraLabel(VIEW_LABEL[view]);
}

function cycleView() {
  if (sceneMode !== 'play') return;
  const order: View[] = panelState.real ? ['top', 'front', 'side'] : ['top', 'front', 'side', 'free'];
  view = order[(order.indexOf(view) + 1) % order.length];
  applyView();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 62 : 45;
  camera.updateProjectionMatrix();
  if (sceneMode === 'play') applyView();
}
window.addEventListener('resize', resize);
resize();

// ---------- 리플레이 ----------
function startReplay() {
  if (sceneMode !== 'play' || !ctrl || ctrl.busy || ctrl.recorder.length < 2) return;
  hud.hideResult();
  replay.active = true;
  replay.frame = 0;
  replay.playing = true;
  hud.showReplay(ctrl.recorder.length);
}

function exitReplay() {
  if (!replay.active) return;
  replay.active = false;
  hud.hideReplay();
  // 리플레이 중 기록된 오브젝트 중 사라진 경품이 있을 수 있어 전체 재동기화
  rigOf().syncAll();
  if (lastResult && ctrl?.phase === 'result') {
    hud.showResult(lastResult, { real: panelState.real, hasReplay: true, onAgain: insertCoin });
  }
}


// ---------- 키보드 ----------
const keyMap = (e: KeyboardEvent): HoldKey | null => {
  switch (e.key) {
    case 'ArrowRight': return 'right';
    case 'ArrowUp': return 'up';
    case 'ArrowLeft': return 'left';
    case 'ArrowDown': return 'down';
    default: return null;
  }
};
window.addEventListener('keydown', (e) => {
  // 세팅 패널의 숫자 입력칸에서 타이핑 중일 때만 게임 조작을 막는다.
  // 드롭다운/버튼에 포커스가 남아 있으면 포커스를 풀어 방향키가 게임으로 가게 한다.
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && t.type !== 'checkbox' && t.type !== 'range') return;
  if (t instanceof HTMLSelectElement || t instanceof HTMLButtonElement) {
    if (keyMap(e) || e.key === ' ' || e.key === 'Enter') t.blur();
  }
  const k = keyMap(e);
  if (k) { input[k] = true; e.preventDefault(); return; }
  if (e.repeat) return;
  if (e.key === 'm' || e.key === 'M' || e.key === 'ㅡ') { toggleMute(); return; }
  if (sceneMode === 'lobby') {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enterNear(); }
    return;
  }
  // Enter·Space 둘 다: 이동 중이면 집기, 대기 중이면 동전
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (ctrl!.phase === 'move') input.drop = true;
    else if (!ctrl!.busy) insertCoin();
  } else if (e.key === 'v' || e.key === 'V' || e.key === 'ㅍ') cycleView();
  else if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') startReplay();
  else if (e.key === 'Escape') {
    // 리플레이 중이면 리플레이만 닫고, 아니면 바로 오락실로 나간다 (판 진행 중에는 못 나감)
    if (replay.active) exitReplay();
    else leaveMachine();
  }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap(e);
  if (k) input[k] = false;
});
window.addEventListener('blur', () => { input.right = input.up = input.left = input.down = input.drop = false; });

// ---------- 무게중심 표시 ----------
// 표시는 기계 로컬 좌표이므로 플레이 중인 기계 그룹에 붙는다
const comLayer = new THREE.Group();
const comMat = new THREE.MeshBasicMaterial({ color: 0xff2255, depthTest: false });
const comGeo = new THREE.SphereGeometry(1, 10, 8);
const comMarkers: THREE.Mesh[] = [];
function updateCom() {
  const rig = rigOf();
  const show = panelState.showCom && !panelState.real;
  const prizes = show ? rig.prizes : [];
  while (comMarkers.length < prizes.length) {
    const m = new THREE.Mesh(comGeo, comMat);
    m.renderOrder = 999;
    comLayer.add(m);
    comMarkers.push(m);
  }
  comMarkers.forEach((m, i) => {
    m.visible = i < prizes.length;
    if (!m.visible) return;
    const p = prizes[i];
    m.position.copy(replay.active ? p.synced[0].obj.position : prizeCenterOfMass(p));
    m.scale.setScalar(rig.claw.L * 0.07);
  });
}

// ---------- 효과음 ----------
let prevPhase: Phase = 'idle';
function updateSound() {
  const ph = replay.active ? 'idle' : ctrl!.phase;
  if (ph !== prevPhase) {
    if (ph === 'drop') sound.play('drop');
    else if (ph === 'grab') sound.play('clunk');
    else if (ph === 'release') sound.play('release');
    prevPhase = ph;
  }
  const g = rigOf().gantry;
  const speed = Math.hypot(g.vx, g.vz) / Math.max(0.01, active().moveSpeed);
  const winch = ph === 'drop' || ph === 'lift';
  sound.motorOn(!replay.active && (g.moving || winch), winch ? 0.7 : speed);
}

// ---------- 배출구 앞 약한 구역 표시 ----------
// 경품 바닥 위에 주황색으로, 배출구에 가까울수록 진하게 (연습 모드 전용)
const zoneOverlay = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
);
zoneOverlay.rotation.x = -Math.PI / 2;
zoneOverlay.renderOrder = 1;
function updateZoneOverlay() {
  const m = cur;
  if (!m?.rig || !ctrl) return;
  const c = m.rig.cabinet, g = m.rig.geom;
  m.group.add(zoneOverlay);
  const range = m.settings.nearChuteRange;
  zoneOverlay.userData.active = range > 0 && m.settings.nearChutePower < 100;
  if (!zoneOverlay.userData.active) return;
  // 기계 바닥 전체를 덮는 텍스처에 구역을 그린다
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const cx = cv.getContext('2d')!;
  const img = cx.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -g.width / 2 + ((i + 0.5) / N) * g.width;
    const z = -g.depth / 2 + ((j + 0.5) / N) * g.depth;
    const inChute = x >= c.chuteMin.x && x <= c.chuteMax.x && z >= c.chuteMin.y && z <= c.chuteMax.y;
    const f = ctrl.zoneFactor(x, z);
    const weak = (1 - f) / Math.max(0.01, 1 - m.settings.nearChutePower / 100); // 0~1
    const k = (j * N + i) * 4;
    img.data.set([255, 146, 43, inChute ? 0 : Math.round(weak * 110)], k);
  }
  cx.putImageData(img, 0, 0);
  const mat = zoneOverlay.material as THREE.MeshBasicMaterial;
  mat.map?.dispose();
  mat.map = new THREE.CanvasTexture(cv);
  mat.map.colorSpace = THREE.SRGBColorSpace;
  mat.needsUpdate = true;
  zoneOverlay.scale.set(g.width, g.depth, 1);
  zoneOverlay.position.set(0, 0.002, 0);
}

// ---------- 조준 도우미 ----------
const aim = new AimGuide(scene);
const AIM_PHASES: Phase[] = ['idle', 'moveX', 'moveZ', 'move', 'result'];

// ---------- 루프 ----------
function updatePlay(dt: number) {
  const rig = rigOf();
  const c = ctrl!;
  if (replay.active) {
    const rec = c.recorder;
    if (replay.playing) {
      replay.frame += dt * 60 * replay.speed;
      if (replay.frame >= rec.length - 1) { replay.frame = rec.length - 1; replay.playing = false; }
    }
    const i = Math.floor(replay.frame);
    const trolley = rec.apply(i);
    rig.claw.syncCableFromObjects(trolley);
    rig.syncGantryVisual(trolley);
    hud.updateReplay(replay.frame, rec.phases[i], replay.playing);
  } else {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 12) {
      rig.claw.preStep();
      c.update(input);
      rig.world.step();
      acc -= DT;
      n++;
    }
    if (n === 12) acc = 0;
    rig.syncAll();
    // 집기(Space)는 한 번 누르면 물리 스텝이 실제로 읽은 뒤에 지운다 (고주사율 화면에서 입력 유실 방지)
    if (n > 0) input.drop = false;
  }
  hud.setPhase(c.phase, c.timeLeft, c.strongTurn && !panelState.real && c.busy, c.busy);
  hud.setMeter(rig.claw.closing ? rig.claw.appliedRatio : 0, THREE.MathUtils.radToDeg(rig.claw.swingAngle()));
  updateCom();
  updateSound();
  zoneOverlay.visible = panelState.showZone && !panelState.real && zoneOverlay.userData.active;
  aim.update(rig, panelState.showAim && !panelState.real && !replay.active && AIM_PHASES.includes(c.phase));
}

hud.showLobby();
hud.setMode(false, '오락실');
hud.setStats(curStats());
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sceneMode === 'lobby') {
    lobby.update(dt, input);
    if (!preparing) hud.setLobbyStatus(lobby.near ? machineLabel(lobby.near) : null, null);
    lobby.draw(now);
  } else {
    updatePlay(dt);
    if (orbit.enabled) orbit.update();
    else {
      const k = camSnap ? 1 : 1 - Math.exp(-dt * 5);
      camSnap = false;
      camera.position.lerp(camGoal.pos, k);
      camLook.lerp(camGoal.look, k);
      camera.lookAt(camLook);
    }
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 디버깅용
Object.assign(window, {
  __claw: {
    get rig() { return cur?.rig; }, get ctrl() { return ctrl; }, get mode() { return sceneMode; },
    input, camera, orbit, machines, lobby, renderer, enter: enterNear, leave: leaveMachine,
  },
});

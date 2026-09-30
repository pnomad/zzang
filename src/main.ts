import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RAPIER, DT } from './physics/world';
import { PRESETS, cloneSettings, randomizeForRealMode, type MachineSettings } from './machine/settings';
import { Rig } from './game/rig';
import { Controller, type Input, type PayoutState } from './game/controller';
import type { AttemptResult } from './game/analysis';
import { prizeCenterOfMass } from './prizes/ragdoll';
import { Hud, type Stats, type HoldKey } from './ui/hud';
import { Panel, type PanelState } from './ui/panel';

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
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.6, 2.2, 1.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -0.7; sun.shadow.camera.right = 0.7;
sun.shadow.camera.top = 0.7; sun.shadow.camera.bottom = -0.7;
sun.shadow.bias = -0.0005;
scene.add(sun);
const room = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x2b2336, roughness: 0.9 }));
room.rotation.x = -Math.PI / 2;
room.receiveShadow = true;
scene.add(room);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 30);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.enabled = false;

// ---------- 상태 ----------
const panelState: PanelState = { real: false, presetIndex: 0, showCom: false };
let practice: MachineSettings = cloneSettings(PRESETS[0].settings);
let active: MachineSettings = practice;
let rig: Rig;
let ctrl: Controller;
let payout: PayoutState = { playsSinceWin: 0, spentSinceWin: 0 };
const input: Input = { right: false, up: false, left: false, down: false, drop: false };

type View = 'front' | 'side' | 'free';
const VIEW_LABEL: Record<View, string> = { front: '정면', side: '옆에서 보기', free: '자유' };
let view: View = 'front';

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
    if (replay.frame >= ctrl.recorder.length - 1) replay.frame = 0;
    replay.playing = !replay.playing;
  },
  replaySpeed: (s) => { replay.speed = s; },
});

const panel = new Panel(active, panelState, {
  preset: (i) => {
    practice = cloneSettings(PRESETS[i].settings);
    active = panelState.real ? randomizeForRealMode(practice) : practice;
    panel.setSettings(active);
    rebuild();
  },
  rebuild: () => rebuild(),
  refill: () => {
    if (ctrl.busy) return;
    exitReplay();
    rig.fillPrizes();
  },
  mode: (real) => {
    panelState.real = real;
    active = real ? randomizeForRealMode(practice) : practice;
    if (!real) view = view === 'free' ? 'front' : view;
    panel.setSettings(active);
    rebuild();
  },
  reveal: () => revealSettings(),
  live: () => {
    rig.claw.cable.setAngularDamping(active.swingDamping);
    hud.setControlMode(active.controlMode, active.price);
  },
  resetStats: () => {
    allStats[panelState.real ? 'real' : 'practice'] = { attempts: 0, wins: 0, spent: 0 };
    saveStats();
    hud.setStats(curStats());
  },
});

function machineLabel() {
  return PRESETS[panelState.presetIndex].name + (panelState.real ? ' (세팅 비공개)' : '');
}

function rebuild() {
  exitReplay();
  hud.hideResult();
  rig?.dispose();
  rig = new Rig(scene, active);
  payout = { playsSinceWin: 0, spentSinceWin: 0 };
  ctrl = new Controller(rig, payout);
  ctrl.onResult = onResult;
  hud.setControlMode(active.controlMode, active.price);
  hud.setMode(panelState.real, machineLabel());
  hud.setStats(curStats());
  applyView();
  rig.syncAll();
}

function insertCoin() {
  if (replay.active) exitReplay();
  hud.hideResult();
  if (!ctrl.start()) return;
  const st = curStats();
  st.attempts++;
  st.spent += active.price;
  saveStats();
  hud.setStats(st);
}

function onResult(r: AttemptResult) {
  lastResult = r;
  if (r.success) {
    curStats().wins++;
    saveStats();
  }
  hud.setStats(curStats());
  hud.showResult(r, { real: panelState.real, hasReplay: ctrl.recorder.length > 1, onAgain: insertCoin });
}

function revealSettings() {
  const s = active;
  const payoutText = s.payoutMode === 'everyN' ? `${s.payoutN}판마다 강집게(${s.strongPower}%)`
    : s.payoutMode === 'amount' ? `₩${s.payoutAmount.toLocaleString('ko-KR')} 쓸 때마다 강집게(${s.strongPower}%)` : '없음';
  const r: AttemptResult = {
    success: false, cause: 'miss', title: '이 기계의 실제 세팅', wonKinds: [], strongTurn: false, trace: [],
    detail: `집을 때 ${s.grabPower}% → 올라갈 때 ${s.liftPower}% → 꼭대기 ${s.topPower}% → 이동 중 ${s.returnPower}%`,
    tips: [
      `확률: ${payoutText}. 지금까지 강집게 없이 ${payout.playsSinceWin}판 진행.`,
      `배출구 가드 높이 ${(s.guardHeight * 100).toFixed(1)}cm, 벌어짐 ${s.openAngleDeg}°, 하강 깊이 ${Math.round(s.dropDepth * 100)}%.`,
      '같은 세팅을 연습 모드로 옮기려면 연습 모드에서 위 숫자를 입력해 보세요.',
    ],
  };
  hud.showResult(r, { real: true, hasReplay: false, onAgain: insertCoin });
}

// ---------- 카메라 ----------
function applyView() {
  const g = rig.geom;
  const sc = g.width / 0.8;
  const H = g.height;
  orbit.enabled = view === 'free';
  if (view === 'front') {
    camera.position.set(0, H * 0.78, g.depth / 2 + 1.25 * sc + 0.12);
    camera.lookAt(0, H * 0.36, 0);
  } else if (view === 'side') {
    camera.position.set(g.width / 2 + 0.95 * sc + 0.1, H * 0.62, 0.02);
    camera.lookAt(0, H * 0.28, 0);
  } else {
    orbit.target.set(0, H * 0.3, 0);
    camera.position.set(0.5 * sc, H * 1.1, g.depth / 2 + 0.9 * sc);
    orbit.update();
  }
  hud.setCameraLabel(VIEW_LABEL[view]);
}

function cycleView() {
  const order: View[] = panelState.real ? ['front', 'side'] : ['front', 'side', 'free'];
  view = order[(order.indexOf(view) + 1) % order.length];
  applyView();
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 62 : 45;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- 리플레이 ----------
function startReplay() {
  if (ctrl.busy || ctrl.recorder.length < 2) return;
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
  rig.syncAll();
  if (lastResult && ctrl.phase === 'result') {
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
  if (e.key === 'Enter') { insertCoin(); e.preventDefault(); }
  else if (e.key === ' ') {
    e.preventDefault();
    if (ctrl.phase === 'move') input.drop = true;
    else if (!ctrl.busy) insertCoin();
  } else if (e.key === 'v' || e.key === 'V' || e.key === 'ㅍ') cycleView();
  else if (e.key === 'r' || e.key === 'R' || e.key === 'ㄱ') startReplay();
  else if (e.key === 'Escape') { if (replay.active) exitReplay(); else hud.hideResult(); }
});
window.addEventListener('keyup', (e) => {
  const k = keyMap(e);
  if (k) input[k] = false;
});
window.addEventListener('blur', () => { input.right = input.up = input.left = input.down = input.drop = false; });

// ---------- 무게중심 표시 ----------
const comMat = new THREE.MeshBasicMaterial({ color: 0xff2255, depthTest: false });
const comGeo = new THREE.SphereGeometry(1, 10, 8);
const comMarkers: THREE.Mesh[] = [];
function updateCom() {
  const show = panelState.showCom && !panelState.real;
  const prizes = show ? rig.prizes : [];
  while (comMarkers.length < prizes.length) {
    const m = new THREE.Mesh(comGeo, comMat);
    m.renderOrder = 999;
    scene.add(m);
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

// ---------- 루프 ----------
rebuild();
let last = performance.now();
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (replay.active) {
    const rec = ctrl.recorder;
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
      ctrl.update(input);
      rig.world.step();
      acc -= DT;
      n++;
    }
    if (n === 12) acc = 0;
    rig.syncAll();
    // 집기(Space)는 한 번 누르면 물리 스텝이 실제로 읽은 뒤에 지운다 (고주사율 화면에서 입력 유실 방지)
    if (n > 0) input.drop = false;
  }

  hud.setPhase(ctrl.phase, ctrl.timeLeft, ctrl.strongTurn && !panelState.real && ctrl.busy, ctrl.busy);
  hud.setMeter(rig.claw.closing ? rig.claw.appliedRatio : 0, THREE.MathUtils.radToDeg(rig.claw.swingAngle()));
  updateCom();
  if (orbit.enabled) orbit.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 디버깅용
Object.assign(window, { __claw: { get rig() { return rig; }, get ctrl() { return ctrl; }, input } });

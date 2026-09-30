/**
 * XZ 갠트리. 축마다 독립적으로 가감속한다 (급정지 시 줄이 흔들리는 원인).
 * smooth > 0 이면 가속도 자체를 그 시간(초)에 걸쳐 서서히 올리고 내린다 (S자 가감속).
 * 미니 기계처럼 줄이 거의 안 흔들리는 기계를 흉내낸다.
 */
export class Gantry {
  vx = 0;
  vz = 0;
  private ax = 0;
  private az = 0;

  constructor(
    public x: number,
    public z: number,
    private readonly min: { x: number; z: number },
    private readonly max: { x: number; z: number },
    private readonly accel: number,
    private readonly smooth = 0,
  ) {}

  /** 한 축의 속도를 목표 속도로. 반환: [새 속도, 새 가속도] */
  private step(v: number, a: number, target: number, dt: number): [number, number] {
    const A = this.accel;
    if (this.smooth <= 0) {
      const dv = A * dt;
      return [v < target ? Math.min(target, v + dv) : Math.max(target, v - dv), 0];
    }
    // 원하는 가속도는 남은 속도 차이에 비례, 실제 가속도는 급하게 바뀌지 않는다
    const want = Math.max(-A, Math.min(A, (target - v) / (this.smooth * 0.7)));
    const jerk = (A / this.smooth) * dt;
    a += Math.max(-jerk, Math.min(jerk, want - a));
    let nv = v + a * dt;
    // 목표 속도를 지나치면 거기서 멈춘다
    if ((v - target) * (nv - target) < 0) { nv = target; a = 0; }
    return [nv, a];
  }

  /** 남은 거리 안에 멈출 수 있는 최대 속도 */
  private stopSpeed(room: number) {
    room = Math.max(0, room - 0.001);
    const A = this.accel * 0.8;
    // S자 가감속은 감속이 붙기까지 smooth초쯤 더 걸린다: v²/2A + v·T = room 을 v에 대해 푼다
    const T = this.smooth;
    return A * (-T + Math.sqrt(T * T + (2 * room) / A));
  }

  private integrate(dt: number) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.x < this.min.x) { this.x = this.min.x; this.vx = this.ax = 0; }
    if (this.x > this.max.x) { this.x = this.max.x; this.vx = this.ax = 0; }
    if (this.z < this.min.z) { this.z = this.min.z; this.vz = this.az = 0; }
    if (this.z > this.max.z) { this.z = this.max.z; this.vz = this.az = 0; }
  }

  /** dirX, dirZ ∈ {-1,0,1} */
  drive(dirX: number, dirZ: number, speed: number, dt: number) {
    // 이동 한계 앞에서는 지금 속도로 멈추는 데 필요한 거리가 남으면 미리 브레이크를 건다
    // (끝에 부딪혀 갑자기 서면 줄이 크게 흔들린다)
    const cap = (pos: number, v: number, dir: number, lo: number, hi: number) => {
      if (dir === 0) return 0;
      const room = dir > 0 ? hi - pos : pos - lo;
      const s = Math.abs(v);
      const stopDist = (s * s) / (2 * this.accel * 0.8) + s * this.smooth * 0.8 + 0.001;
      // 여유를 두어 브레이크를 건 뒤 다시 가속했다가 부딪히는 일이 없게
      return room <= stopDist * 1.6 + 0.006 ? 0 : dir * speed;
    };
    [this.vx, this.ax] = this.step(this.vx, this.ax, cap(this.x, this.vx, dirX, this.min.x, this.max.x), dt);
    [this.vz, this.az] = this.step(this.vz, this.az, cap(this.z, this.vz, dirZ, this.min.z, this.max.z), dt);
    this.integrate(dt);
  }

  /** 목표 지점으로 이동. 도착하면 true */
  moveTo(tx: number, tz: number, speed: number, dt: number): boolean {
    const target = (pos: number, t: number) => {
      const d = t - pos;
      return Math.sign(d) * Math.min(speed, this.stopSpeed(Math.abs(d)));
    };
    [this.vx, this.ax] = this.step(this.vx, this.ax, target(this.x, tx), dt);
    [this.vz, this.az] = this.step(this.vz, this.az, target(this.z, tz), dt);
    this.integrate(dt);
    const done = Math.abs(tx - this.x) < 0.003 && Math.abs(tz - this.z) < 0.003;
    if (done) { this.vx = this.vz = this.ax = this.az = 0; this.x = tx; this.z = tz; }
    return done;
  }

  get moving() { return Math.abs(this.vx) + Math.abs(this.vz) > 1e-4; }
}

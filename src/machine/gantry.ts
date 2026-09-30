/** XZ 갠트리. 축마다 독립적으로 가감속한다 (급정지 시 줄이 흔들리는 원인). */
export class Gantry {
  vx = 0;
  vz = 0;

  constructor(
    public x: number,
    public z: number,
    private readonly min: { x: number; z: number },
    private readonly max: { x: number; z: number },
    private readonly accel: number,
  ) {}

  private approach(v: number, target: number, dt: number) {
    const dv = this.accel * dt;
    return v < target ? Math.min(target, v + dv) : Math.max(target, v - dv);
  }

  private integrate(dt: number) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.x < this.min.x) { this.x = this.min.x; this.vx = 0; }
    if (this.x > this.max.x) { this.x = this.max.x; this.vx = 0; }
    if (this.z < this.min.z) { this.z = this.min.z; this.vz = 0; }
    if (this.z > this.max.z) { this.z = this.max.z; this.vz = 0; }
  }

  /** dirX, dirZ ∈ {-1,0,1} */
  drive(dirX: number, dirZ: number, speed: number, dt: number) {
    this.vx = this.approach(this.vx, dirX * speed, dt);
    this.vz = this.approach(this.vz, dirZ * speed, dt);
    this.integrate(dt);
  }

  /** 목표 지점으로 이동. 도착하면 true */
  moveTo(tx: number, tz: number, speed: number, dt: number): boolean {
    const axis = (pos: number, v: number, target: number) => {
      const d = target - pos;
      const vmax = Math.min(speed, Math.sqrt(2 * this.accel * Math.abs(d) * 0.9));
      return this.approach(v, Math.sign(d) * vmax, dt);
    };
    this.vx = axis(this.x, this.vx, tx);
    this.vz = axis(this.z, this.vz, tz);
    this.integrate(dt);
    const done = Math.abs(tx - this.x) < 0.003 && Math.abs(tz - this.z) < 0.003;
    if (done) { this.vx = 0; this.vz = 0; this.x = tx; this.z = tz; }
    return done;
  }

  get moving() { return Math.abs(this.vx) + Math.abs(this.vz) > 1e-4; }
}

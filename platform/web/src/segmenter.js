// JavaScript port of the app's MotionSegmenter (CONTRACT.md §3 item 7; android/.../core/MotionSegmenter.kt).
// Same rules, same defaults, same test cases (test/segmenter.test.js). Keep the three implementations in step.
export const POINTS = 21;

export const DEFAULT_CONFIG = {
  startSpeed: 1.0, stopSpeed: 0.5, stopHoldMs: 200, padMs: 150,
  minMs: 300, maxMs: 2500, maxMissing: 0.25,
};

const hypot = (a, b) => Math.sqrt(a * a + b * b);

function handSize(p) {
  let max = 0;
  for (let i = 1; i < POINTS; i++) max = Math.max(max, hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]));
  return max;
}

export class MotionSegmenter {
  constructor(config = {}) {
    this.c = { ...DEFAULT_CONFIG, ...config };
    this.buffer = [];
    this.prev = null;
    this.speeds = [];
    this.moving = false;
    this.startMs = 0;
    this.belowSinceMs = null;
    this.lastHandMs = null;
  }

  /** @returns {{moving: boolean, segment: null | {startMs: number, endMs: number, frames: {t_ms: number, landmarks: number[] | null}[]}}} */
  onFrame(tMs, landmarks) {
    const c = this.c;
    const frame = { t_ms: tMs, landmarks };
    this.buffer.push(frame);
    while (tMs - this.buffer[0].t_ms > c.maxMs + c.padMs + c.stopHoldMs) this.buffer.shift();
    const smoothed = this.#smoothedSpeed(frame);
    this.prev = frame;
    if (landmarks) this.lastHandMs = tMs;

    if (!this.moving) {
      if (smoothed !== null && smoothed > c.startSpeed) {
        this.moving = true;
        this.startMs = tMs;
        this.belowSinceMs = null;
      }
      return { moving: this.moving, segment: null };
    }

    let endMs = null;
    if (!landmarks) {
      if (this.lastHandMs !== null && tMs - this.lastHandMs > c.stopHoldMs) endMs = this.lastHandMs;
    } else if (smoothed === null) {
      endMs = null;
    } else if (smoothed < c.stopSpeed) {
      if (this.belowSinceMs === null) this.belowSinceMs = tMs;
      if (tMs - this.belowSinceMs >= c.stopHoldMs) endMs = this.belowSinceMs;
    } else {
      this.belowSinceMs = null;
    }
    if (endMs === null) return { moving: true, segment: null };
    this.moving = false;
    this.belowSinceMs = null;
    return { moving: false, segment: this.#build(this.startMs - c.padMs, endMs) };
  }

  #smoothedSpeed(frame) {
    const cur = frame.landmarks;
    if (!cur) { this.speeds = []; return null; }
    const before = this.prev?.landmarks;
    if (!before) return null;
    const dtSec = (frame.t_ms - this.prev.t_ms) / 1000;
    const size = handSize(cur);
    if (dtSec <= 0 || size <= 0) return null;
    let moved = 0;
    for (let i = 0; i < POINTS; i++) moved += hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1]);
    this.speeds.push(moved / POINTS / size / dtSec);
    if (this.speeds.length > 3) this.speeds.shift();
    return this.speeds.reduce((a, b) => a + b, 0) / this.speeds.length;
  }

  #build(fromMs, toMs) {
    const c = this.c;
    const duration = toMs - fromMs;
    if (duration < c.minMs || duration > c.maxMs) return null;
    const frames = this.buffer.filter((f) => f.t_ms >= fromMs && f.t_ms <= toMs);
    if (!frames.length) return null;
    const missing = frames.filter((f) => !f.landmarks).length / frames.length;
    if (missing > c.maxMissing || missing === 1) return null;
    return { startMs: fromMs, endMs: toMs, frames: frames.map((f) => ({ t_ms: f.t_ms, landmarks: f.landmarks })) };
  }
}

/** Runs a whole recorded clip through the segmenter. A few empty frames are appended so a movement still going at
 *  the end of the clip is closed. Returns the kept segments (each with its raw frames). */
export function segmentClip(frames, config = {}) {
  const seg = new MotionSegmenter(config);
  const out = [];
  for (const f of frames) {
    const r = seg.onFrame(f.t_ms, f.landmarks);
    if (r.segment) out.push(r.segment);
  }
  const last = frames.length ? frames[frames.length - 1].t_ms : 0;
  for (let k = 1; k <= 12; k++) {
    const r = seg.onFrame(last + k * 33, null);
    if (r.segment) out.push(r.segment);
  }
  return out;
}

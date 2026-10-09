// Same cases as android/.../MotionSegmenterTest.kt: both implementations must agree to the millisecond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MotionSegmenter, segmentClip, DEFAULT_CONFIG } from '../src/segmenter.js';

const hand = (cx) => Array.from({ length: 63 }, (_, k) => (k % 3 === 0 ? cx + 0.01 * (k / 3) : k % 3 === 1 ? 0.5 : 0));
/** Runs frames n = 0.. at t = 33n; cxAt returns null for "no hand". */
const run = (seg, count, cxAt) =>
  Array.from({ length: count }, (_, n) => [n, seg.onFrame(33 * n, cxAt(n) === null ? null : hand(cxAt(n)))]);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const oneMovement = (n) => 0.3 + 0.03 * (clamp(n, 9, 29) - 9);

test('one movement gives one segment with the Kotlin boundaries', () => {
  const out = run(new MotionSegmenter(), 45, oneMovement);
  const segs = out.filter(([, r]) => r.segment).map(([, r]) => r.segment);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].startMs, 180);
  assert.equal(segs[0].endMs, 1056);
  assert.equal(out.find(([, r]) => r.segment)[0], 39);
  assert.ok(out[20][1].moving);
  assert.ok(!out[44][1].moving);
  assert.equal(segs[0].frames[0].t_ms >= 180, true);
});

test('a still hand never moves', () => {
  const out = run(new MotionSegmenter(), 60, () => 0.4);
  assert.ok(out.every(([, r]) => !r.moving && !r.segment));
});

test('a movement that is too short is ignored', () => {
  const out = run(new MotionSegmenter({ padMs: 0, minMs: 300 }), 40, (n) => 0.3 + 0.03 * (clamp(n, 9, 12) - 9));
  assert.ok(out.every(([, r]) => !r.segment));
});

test('losing the hand ends the segment at the last frame that had a hand', () => {
  const out = run(new MotionSegmenter(), 46, (n) => (n >= 30 ? null : oneMovement(n)));
  const hits = out.filter(([, r]) => r.segment);
  assert.equal(hits.length, 1);
  assert.equal(hits[0][1].segment.endMs, 957);
  assert.equal(hits[0][0], 36);
});

test('too many missing frames discards the segment', () => {
  const seg = new MotionSegmenter({ padMs: 0 });
  const out = run(seg, 60, (n) => (n < 10 ? 0.3 : n <= 39 ? ((n - 10) % 3 === 2 ? null : 0.3 + 0.03 * (n - 9)) : 0.3 + 0.03 * 30));
  assert.ok(out.every(([, r]) => !r.segment));
});

test('odd timestamps never throw', () => {
  const seg = new MotionSegmenter();
  for (let i = 0; i < 20; i++) seg.onFrame(1000, hand(0.3 + 0.05 * i));
  for (let i = 0; i < 20; i++) seg.onFrame(500, hand(0.3));
  for (let i = 0; i < 5; i++) seg.onFrame(400, null);
});

test('segmentClip closes a movement that is still going when the clip ends', () => {
  const frames = Array.from({ length: 30 }, (_, n) => ({ t_ms: 33 * n, landmarks: hand(0.3 + 0.03 * Math.max(0, n - 9)) }));
  const segs = segmentClip(frames);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].frames.length > 10);
  assert.ok(DEFAULT_CONFIG.minMs <= segs[0].endMs - segs[0].startMs);
});

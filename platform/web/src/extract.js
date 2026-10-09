// Landmark extraction in the browser with MediaPipe (docs/architecture.md §1 step ①). Only landmark numbers leave the
// computer, never the video. Landmarks are the SAME 63 raw floats the Android app reads (CONTRACT.md §3 item 1).
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { segmentClip } from './segmenter.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

let landmarkerPromise = null;
async function landmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      const make = (delegate) => HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate }, numHands: 1, runningMode: 'IMAGE',
      });
      try { return await make('GPU'); } catch { return make('CPU'); }
    })();
    landmarkerPromise.catch(() => { landmarkerPromise = null; });
  }
  return landmarkerPromise;
}

function flatten(result) {
  const hand = result.landmarks?.[0];
  if (!hand || hand.length !== 21) return null;
  const out = new Array(63);
  hand.forEach((p, i) => { out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; });
  return out;
}
const handedness = (result) => result.handedness?.[0]?.[0]?.categoryName ?? null;

/** Small JPEG data URL of what the camera saw, for reviewing uploads. */
function thumb(source) {
  const c = document.createElement('canvas');
  c.width = 72; c.height = 72;
  const w = source.videoWidth || source.width, h = source.videoHeight || source.height;
  const s = Math.min(w, h);
  c.getContext('2d').drawImage(source, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 72, 72);
  return c.toDataURL('image/jpeg', 0.6);
}

export const isVideo = (file) => file.type.startsWith('video/');
export const isImage = (file) => file.type.startsWith('image/');

async function detectImage(file) {
  const lm = await landmarker();
  await lm.setOptions({ runningMode: 'IMAGE' });
  const bitmap = await createImageBitmap(file);
  const result = lm.detect(bitmap);
  const out = { landmarks: flatten(result), handedness: handedness(result), thumb: thumb(bitmap) };
  bitmap.close();
  return out;
}

function loadVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error(`can't read video ${file.name}`));
  });
}
const seek = (v, t) => new Promise((resolve) => { v.onseeked = () => resolve(); v.currentTime = t; });

/** Steps through a video every `stepMs`, running the hand model on each frame. */
async function videoFrames(file, { stepMs, skipStartMs = 0, skipEndMs = 0, thumbEvery = 0 }, onProgress) {
  const lm = await landmarker();
  await lm.setOptions({ runningMode: 'VIDEO' });
  const v = await loadVideo(file);
  const frames = [];
  const endMs = v.duration * 1000 - skipEndMs;
  let i = 0, last = -1;
  for (let t = skipStartMs; t <= endMs; t += stepMs, i++) {
    await seek(v, t / 1000);
    const ts = Math.max(Math.round(t), last + 1); // MediaPipe needs strictly increasing timestamps
    last = ts;
    const result = lm.detectForVideo(v, ts);
    frames.push({ t_ms: Math.round(t), landmarks: flatten(result), handedness: handedness(result),
      thumb: thumbEvery && i % thumbEvery === 0 ? thumb(v) : null });
    if (i % 5 === 0) onProgress?.(Math.min(1, (t - skipStartMs) / Math.max(1, endMs - skipStartMs)));
  }
  URL.revokeObjectURL(v.src);
  return frames;
}

/** One file -> the JSON body of POST /api/signs/:id/uploads (docs/architecture.md §4.2). */
export async function extractForSign(file, kind, onProgress) {
  if (kind === 'static') {
    if (isImage(file)) {
      const r = await detectImage(file);
      return { filename: file.name, no_hand_frames: r.landmarks ? 0 : 1,
        samples: r.landmarks ? [{ landmarks: r.landmarks, handedness: r.handedness, thumb: r.thumb }] : [] };
    }
    // video: one frame every 0.1 s, skipping the first and last 0.5 s (spec §4.2)
    const frames = await videoFrames(file, { stepMs: 100, skipStartMs: 500, skipEndMs: 500, thumbEvery: 8 }, onProgress);
    const withHand = frames.filter((f) => f.landmarks);
    return { filename: file.name, no_hand_frames: frames.length - withHand.length,
      samples: withHand.map((f, k) => ({ landmarks: f.landmarks, handedness: f.handedness, frame_index: k, thumb: f.thumb })) };
  }
  if (!isVideo(file)) throw new Error('motion signs need a video (a short clip with repeated movements and pauses)');
  const frames = await videoFrames(file, { stepMs: 33, thumbEvery: 0 }, onProgress);
  const segments = segmentClip(frames.map((f) => ({ t_ms: f.t_ms, landmarks: f.landmarks })));
  const hands = new Map(frames.map((f) => [f.t_ms, f.handedness]));
  return {
    filename: file.name,
    no_hand_frames: frames.filter((f) => !f.landmarks).length,
    sequences: segments.map((s) => ({
      duration_ms: Math.round(s.endMs - s.startMs),
      handedness: [...s.frames].map((f) => hands.get(f.t_ms)).find(Boolean) ?? null,
      frames: s.frames,
    })),
  };
}

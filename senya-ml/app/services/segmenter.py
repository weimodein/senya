"""Python port of the app's MotionSegmenter (CONTRACT.md §3 item 7; android/.../core/MotionSegmenter.kt).

Same rules, same defaults, same test cases (tests/test_segmenter.py). Keep the implementations in step.
Frames are dicts {"t_ms": int, "landmarks": [63 floats] | None}.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

POINTS = 21

DEFAULT_CONFIG = {
    "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200, "pad_ms": 150,
    "min_ms": 300, "max_ms": 2500, "max_missing": 0.25,
}


def _hand_size(p) -> float:
    return max(math.hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]) for i in range(1, POINTS))


@dataclass
class Segment:
    start_ms: float
    end_ms: float
    frames: list


@dataclass
class Step:
    moving: bool
    segment: Optional[Segment] = None


@dataclass
class MotionSegmenter:
    config: dict = field(default_factory=dict)

    def __post_init__(self):
        self.c = {**DEFAULT_CONFIG, **self.config}
        self.buffer: list = []
        self.prev: Optional[dict] = None
        self.speeds: list = []
        self.moving = False
        self.start_ms = 0.0
        self.below_since_ms: Optional[float] = None
        self.last_hand_ms: Optional[float] = None

    def on_frame(self, t_ms: float, landmarks) -> Step:
        c = self.c
        frame = {"t_ms": t_ms, "landmarks": landmarks}
        self.buffer.append(frame)
        while t_ms - self.buffer[0]["t_ms"] > c["max_ms"] + c["pad_ms"] + c["stop_hold_ms"]:
            self.buffer.pop(0)
        smoothed = self._smoothed_speed(frame)
        self.prev = frame
        if landmarks is not None:
            self.last_hand_ms = t_ms

        if not self.moving:
            if smoothed is not None and smoothed > c["start_speed"]:
                self.moving = True
                self.start_ms = t_ms
                self.below_since_ms = None
            return Step(self.moving)

        end_ms = None
        if landmarks is None:
            if self.last_hand_ms is not None and t_ms - self.last_hand_ms > c["stop_hold_ms"]:
                end_ms = self.last_hand_ms
        elif smoothed is None:
            end_ms = None
        elif smoothed < c["stop_speed"]:
            if self.below_since_ms is None:
                self.below_since_ms = t_ms
            if t_ms - self.below_since_ms >= c["stop_hold_ms"]:
                end_ms = self.below_since_ms
        else:
            self.below_since_ms = None
        if end_ms is None:
            return Step(True)
        self.moving = False
        self.below_since_ms = None
        return Step(False, self._build(self.start_ms - c["pad_ms"], end_ms))

    def _smoothed_speed(self, frame) -> Optional[float]:
        cur = frame["landmarks"]
        if cur is None:
            self.speeds = []
            return None
        before = self.prev["landmarks"] if self.prev else None
        if before is None:
            return None
        dt_sec = (frame["t_ms"] - self.prev["t_ms"]) / 1000
        size = _hand_size(cur)
        if dt_sec <= 0 or size <= 0:
            return None
        moved = sum(math.hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1]) for i in range(POINTS))
        self.speeds.append(moved / POINTS / size / dt_sec)
        if len(self.speeds) > 3:
            self.speeds.pop(0)
        return sum(self.speeds) / len(self.speeds)

    def _build(self, from_ms: float, to_ms: float) -> Optional[Segment]:
        c = self.c
        duration = to_ms - from_ms
        if duration < c["min_ms"] or duration > c["max_ms"]:
            return None
        frames = [f for f in self.buffer if from_ms <= f["t_ms"] <= to_ms]
        if not frames:
            return None
        missing = sum(1 for f in frames if f["landmarks"] is None) / len(frames)
        if missing > c["max_missing"] or missing == 1:
            return None
        return Segment(from_ms, to_ms, [{"t_ms": f["t_ms"], "landmarks": f["landmarks"]} for f in frames])


def segment_clip(frames: list, config: Optional[dict] = None) -> list:
    """Runs a whole recorded clip through the segmenter. A few empty frames are appended so a movement still
    going at the end of the clip is closed. Returns the kept segments (each with its raw frames)."""
    seg = MotionSegmenter(config or {})
    out = []
    for f in frames:
        r = seg.on_frame(f["t_ms"], f["landmarks"])
        if r.segment:
            out.append(r.segment)
    last = frames[-1]["t_ms"] if frames else 0
    for k in range(1, 13):
        r = seg.on_frame(last + k * 33, None)
        if r.segment:
            out.append(r.segment)
    return out

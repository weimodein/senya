"""Same cases as android/.../MotionSegmenterTest.kt: every implementation must agree to the millisecond."""
from app.services.segmenter import DEFAULT_CONFIG, MotionSegmenter, segment_clip


def hand(cx):
    return [cx + 0.01 * (k // 3) if k % 3 == 0 else 0.5 if k % 3 == 1 else 0.0 for k in range(63)]


def run(seg, count, cx_at):
    out = []
    for n in range(count):
        cx = cx_at(n)
        out.append((n, seg.on_frame(33 * n, None if cx is None else hand(cx))))
    return out


def clamp(n, lo, hi):
    return min(hi, max(lo, n))


def one_movement(n):
    return 0.3 + 0.03 * (clamp(n, 9, 29) - 9)


def test_one_movement_gives_one_segment_with_the_kotlin_boundaries():
    out = run(MotionSegmenter(), 45, one_movement)
    segs = [r.segment for _, r in out if r.segment]
    assert len(segs) == 1
    assert segs[0].start_ms == 180
    assert segs[0].end_ms == 1056
    assert next(n for n, r in out if r.segment) == 39
    assert out[20][1].moving
    assert not out[44][1].moving
    assert segs[0].frames[0]["t_ms"] >= 180


def test_a_still_hand_never_moves():
    out = run(MotionSegmenter(), 60, lambda n: 0.4)
    assert all(not r.moving and not r.segment for _, r in out)


def test_a_movement_that_is_too_short_is_ignored():
    out = run(MotionSegmenter({"pad_ms": 0, "min_ms": 300}), 40, lambda n: 0.3 + 0.03 * (clamp(n, 9, 12) - 9))
    assert all(not r.segment for _, r in out)


def test_losing_the_hand_ends_the_segment_at_the_last_frame_that_had_a_hand():
    out = run(MotionSegmenter(), 46, lambda n: None if n >= 30 else one_movement(n))
    hits = [(n, r) for n, r in out if r.segment]
    assert len(hits) == 1
    assert hits[0][1].segment.end_ms == 957
    assert hits[0][0] == 36


def test_too_many_missing_frames_discards_the_segment():
    def cx(n):
        if n < 10:
            return 0.3
        if n <= 39:
            return None if (n - 10) % 3 == 2 else 0.3 + 0.03 * (n - 9)
        return 0.3 + 0.03 * 30
    out = run(MotionSegmenter({"pad_ms": 0}), 60, cx)
    assert all(not r.segment for _, r in out)


def test_odd_timestamps_never_throw():
    seg = MotionSegmenter()
    for i in range(20):
        seg.on_frame(1000, hand(0.3 + 0.05 * i))
    for _ in range(20):
        seg.on_frame(500, hand(0.3))
    for _ in range(5):
        seg.on_frame(400, None)


def test_segment_clip_closes_a_movement_that_is_still_going_when_the_clip_ends():
    frames = [{"t_ms": 33 * n, "landmarks": hand(0.3 + 0.03 * max(0, n - 9))} for n in range(30)]
    segs = segment_clip(frames)
    assert len(segs) == 1
    assert len(segs[0].frames) > 10
    assert DEFAULT_CONFIG["min_ms"] <= segs[0].end_ms - segs[0].start_ms

"""find_hold keeps only the held letter from a rest -> raise -> hold -> lower -> rest clip."""
from app.services.extract import find_hold


def hand(cx, wrist_y):
    """A 21-point hand ~0.2 wide whose wrist sits at (cx, wrist_y)."""
    pts = [(cx, wrist_y)] + [(cx + 0.01 * k, wrist_y - 0.01 * k) for k in range(1, 21)]
    return [v for x, y in pts for v in (x, y, 0.0)]


def clip(phases, step_ms=33):
    """phases: list of (n_frames, start_y, end_y, jitter) — y moves linearly; None start_y = no hand."""
    frames, t = [], 0
    for n, y0, y1, jitter in phases:
        for k in range(n):
            if y0 is None:
                lm = None
            else:
                y = y0 + (y1 - y0) * k / max(1, n - 1)
                lm = hand(0.5 + (jitter if k % 2 else 0), y)
            frames.append({"t_ms": t, "landmarks": lm, "phase": (y0, y1)})
            t += step_ms
    return frames


def test_keeps_the_hold_and_drops_the_raise_and_lower():
    frames = clip([(10, None, None, 0), (8, 0.9, 0.55, 0), (30, 0.55, 0.55, 0.0005), (8, 0.55, 0.9, 0), (10, None, None, 0)])
    hold = find_hold(frames)
    assert hold
    assert all(f["phase"] == (0.55, 0.55) for f in hold)
    assert 600 <= hold[-1]["t_ms"] - hold[0]["t_ms"] <= 1000  # ~1 s hold minus the trimmed ends


def test_a_visible_resting_hand_loses_to_the_raised_hold():
    rest = (40, 0.95, 0.95, 0.0)  # long, perfectly still, low in the picture
    frames = clip([rest, (8, 0.95, 0.55, 0), (20, 0.55, 0.55, 0.0), (8, 0.55, 0.95, 0), rest])
    hold = find_hold(frames)
    assert hold and all(f["phase"] == (0.55, 0.55) for f in hold)


def test_no_hold_when_the_hand_never_stops():
    frames = clip([(40, 0.9, 0.3, 0)])
    assert find_hold(frames) is None


def test_a_too_short_pause_is_not_a_hold():
    frames = clip([(8, 0.9, 0.55, 0), (6, 0.55, 0.55, 0), (8, 0.55, 0.9, 0)])  # ~200 ms pause
    assert find_hold(frames) is None

"""find_single_take keeps the one movement of a rest -> raise -> (hold) -> MOVE -> settle -> lower -> rest clip."""
import json
import pathlib

import pytest

from app.services.extract import ExtractionError, _single_from_video, find_single_take

J_TRACKS = json.loads((pathlib.Path(__file__).parent / "fixtures" / "j_tracks.json").read_text())
PAD_MS = 150


def hand(x, y):
    """A 21-point hand ~0.28 wide whose wrist sits at (x, y)."""
    pts = [(x, y)] + [(x + 0.01 * k, y - 0.01 * k) for k in range(1, 21)]
    return [v for px, py in pts for v in (px, py, 0.0)]


def clip(phases, step_ms=33):
    """phases: (name, n_frames, (x0, y0) | None, (x1, y1) | None); the wrist moves linearly, None = no hand."""
    frames, t = [], 0
    for name, n, a, b in phases:
        for k in range(n):
            lm = None if a is None else hand(a[0] + (b[0] - a[0]) * k / max(1, n - 1),
                                             a[1] + (b[1] - a[1]) * k / max(1, n - 1))
            frames.append({"t_ms": t, "landmarks": lm, "phase": name})
            t += step_ms
    return frames


LOW_L, TOP, SIDE, LOW_R = (0.5, 0.95), (0.5, 0.55), (0.75, 0.55), (0.75, 0.95)
AWAY = ("away", 10, None, None)
RAISE, LOWER = ("raise", 8, LOW_L, TOP), ("lower", 8, SIDE, LOW_R)
HOLD, MOVE, SETTLE = ("hold", 10, TOP, TOP), ("move", 12, TOP, SIDE), ("settle", 12, SIDE, SIDE)


def phases_in(segment, frames):
    by_t = {f["t_ms"]: f["phase"] for f in frames}
    return [by_t[f["t_ms"]] for f in segment.frames]


def first_t(frames, phase):
    return min(f["t_ms"] for f in frames if f["phase"] == phase)


def test_keeps_the_movement_and_cuts_the_raise_and_lower_for_none():
    frames = clip([AWAY, RAISE, HOLD, MOVE, SETTLE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    got = phases_in(take.sign, frames)
    assert got.count("move") == 12
    assert "raise" not in got and "lower" not in got
    assert len(take.rest) == 2
    assert phases_in(take.rest[0], frames).count("raise") == 8
    assert phases_in(take.rest[1], frames).count("lower") == 8


def test_a_movement_straight_out_of_the_raise_only_borrows_the_pad():
    frames = clip([AWAY, RAISE, MOVE, SETTLE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    assert phases_in(take.sign, frames).count("move") == 12
    start = first_t(frames, "move")
    assert all(f["t_ms"] >= start - PAD_MS for f in take.sign.frames)


def test_a_movement_running_straight_into_the_lower_stops_before_it():
    frames = clip([AWAY, RAISE, HOLD, MOVE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    got = phases_in(take.sign, frames)
    assert got.count("move") == 12 and "lower" not in got


def test_no_hand_is_no_take():
    assert find_single_take(clip([("away", 40, None, None)])) is None


def test_raise_hold_lower_without_a_movement_is_no_take():
    frames = clip([AWAY, RAISE, ("hold", 30, TOP, TOP), ("lower", 8, TOP, LOW_L), AWAY])
    assert find_single_take(frames) is None


@pytest.mark.parametrize("name", sorted(J_TRACKS))
def test_real_j_clips_give_exactly_one_j_between_the_raise_and_the_lower(name):
    frames, why = J_TRACKS[name]["frames"], J_TRACKS[name]["why"]
    take = find_single_take(frames)
    assert take is not None, why
    assert 700 <= take.sign.end_ms - take.sign.start_ms <= 2000, why
    hand_t = [f["t_ms"] for f in frames if f["landmarks"] is not None]
    assert hand_t[0] < take.sign.start_ms and take.sign.end_ms < hand_t[-1], why
    assert len(take.rest) == 2, why


def test_single_from_video_returns_one_sequence_and_the_none_cuts():
    out = _single_from_video(J_TRACKS["signer-02/IMG_4431.MOV"]["frames"])
    assert out["kind"] == "motion"
    assert len(out["sequences"]) == 1 and len(out["none_sequences"]) == 2
    seq = out["sequences"][0]
    assert 700 <= seq["duration_ms"] <= 2000
    assert seq["thumb"] is None  # fixture tracks carry no pixels
    assert all(f["landmarks"] is None or len(f["landmarks"]) == 63 for f in seq["frames"])


def test_single_from_video_explains_a_clip_without_a_movement():
    frames = clip([AWAY, RAISE, ("hold", 30, TOP, TOP), ("lower", 8, TOP, LOW_L), AWAY])
    with pytest.raises(ExtractionError, match="sign once"):
        _single_from_video(frames)


def test_a_hand_resting_in_view_before_the_raise_does_not_leak_into_the_sign():
    rest = ("rest", 30, LOW_L, LOW_L)
    frames = clip([rest, RAISE, HOLD, MOVE, SETTLE, LOWER, AWAY])
    take = find_single_take(frames)
    assert take is not None
    got = phases_in(take.sign, frames)
    assert "raise" not in got and "rest" not in got and got.count("move") == 12
    assert len(take.rest) == 2
    assert phases_in(take.rest[0], frames).count("raise") == 8

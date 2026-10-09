"""Regenerates j_tracks.json: the hand tracks (never the videos) of 4 real FSL "J" clips, one per signer.

Usage, from senya-ml/:
    .venv/Scripts/python.exe tests/fixtures/make_j_tracks.py "C:/Users/Dell/Desktop/trysigla/sigla/datasets/LETTERS(A-L)/J"
"""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from app.services.extract import _track_video  # noqa: E402

CLIPS = {
    "signer-01/IMG_4646.MOV": "the settle before the lower is shorter than stop_hold_ms",
    "signer-02/IMG_4431.MOV": "typical: raise, short pause, J, settle, lower",
    "signer-03/IMG_4542.MOV": "no pause at all between the raise and the J",
    "signer-04/IMG_5305.MOV": "the wrist rises during the J itself",
}


def main(dataset: str):
    out = {}
    for name, why in CLIPS.items():
        frames = _track_video(str(pathlib.Path(dataset) / name))
        out[name] = {"why": why, "frames": [
            {"t_ms": f["t_ms"], "landmarks": None if f["landmarks"] is None else [round(v, 4) for v in f["landmarks"]]}
            for f in frames]}
    path = pathlib.Path(__file__).with_name("j_tracks.json")
    path.write_text(json.dumps(out, separators=(",", ":")))
    print(path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main(sys.argv[1])

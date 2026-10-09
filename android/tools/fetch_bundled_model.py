#!/usr/bin/env python3
"""Copy the currently published model into the app's bundled assets (spec §5.2: the bundled model is version 0).

Usage: python android/tools/fetch_bundled_model.py http://<server>:8000
Works against the real platform or fixtures/mock_server (python -m http.server 8000).
"""
import hashlib
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[1] / "app" / "src" / "main" / "assets" / "model"


def get(base: str, path: str) -> bytes:
    with urllib.request.urlopen(urllib.parse.urljoin(base + "/", path), timeout=10) as response:
        return response.read()


def sibling(url: str, name: str) -> str:
    return url.rsplit("/", 1)[0] + "/" + name


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    base = sys.argv[1].rstrip("/")
    latest = json.loads(get(base, "/api/model/latest"))
    files = {
        "model.tflite": latest["model_url"],
        "labels.json": latest["labels_url"],
        "golden.json": sibling(latest["model_url"], "golden.json"),
    }
    checksums = {"model.tflite": latest["sha256"]}
    motion = latest.get("motion")
    if motion:
        files.update({
            "motion.tflite": motion["model_url"],
            "motion_labels.json": motion["labels_url"],
            "motion_config.json": motion["config_url"],
            "motion_golden.json": sibling(motion["model_url"], "motion_golden.json"),
        })
        checksums["motion.tflite"] = motion["sha256"]

    data = {name: get(base, url) for name, url in files.items()}
    for name, expected in checksums.items():
        if hashlib.sha256(data[name]).hexdigest().lower() != expected.lower():
            sys.exit(f"sha256 mismatch for {name}")

    ASSETS.mkdir(parents=True, exist_ok=True)
    for old in ASSETS.iterdir():
        old.unlink()
    for name, content in data.items():
        (ASSETS / name).write_bytes(content)
    kind = "static + motion" if motion else "static only"
    print(f"Bundled server version {latest['version']} ({kind}) into {ASSETS}")


if __name__ == "__main__":
    main()

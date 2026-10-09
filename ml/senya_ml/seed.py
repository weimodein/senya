"""Fill a running server with synthetic clips through the real upload API (for end-to-end tests and demos)."""
from __future__ import annotations

import requests

from .client import Server


def seed(server: Server, export: dict) -> dict:
    existing = {s["label"]: s for s in requests.get(server._url("/api/signs"), headers=server.headers, timeout=30).json()}
    counts = {}
    for sign in export["signs"]:
        s = existing.get(sign["label"])
        if s is None:
            r = requests.post(server._url("/api/signs"), headers=server.headers, timeout=30,
                              json={"label": sign["label"], "kind": sign["kind"], "start_shapes": sign.get("start_shapes")})
            r.raise_for_status()
            s = r.json()
        total = 0
        for i, up in enumerate(sign["uploads"]):
            if sign["kind"] == "static":
                body = {"filename": f"synthetic-{sign['label']}-{i}.mp4", "samples": [{"landmarks": x} for x in up["samples"]]}
            else:
                body = {"filename": f"synthetic-{sign['label']}-{i}.mp4",
                        "sequences": [{"frames": q["frames"]} for q in up["sequences"]]}
            r = requests.post(server._url(f"/api/signs/{s['id']}/uploads"), headers=server.headers, json=body, timeout=120)
            r.raise_for_status()
            total += r.json()["samples_added"] + r.json()["segments_found"]
        counts[sign["label"]] = total
    return counts

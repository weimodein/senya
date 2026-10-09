"""python -m senya_ml.cli <command>

  make-fixtures   train dummy models on synthetic data, write fixtures/mock_server (M1)
  train           train from a JSON export file or --synthetic, write a model folder
  worker          poll the server for train jobs (needs SENYA_SERVER and SENYA_ADMIN_TOKEN)
"""
import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def main(argv=None):
    p = argparse.ArgumentParser(prog="senya_ml")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("make-fixtures")
    f.add_argument("--out", default=str(REPO / "fixtures" / "mock_server"))
    f.add_argument("--version", type=int, default=0)
    f.add_argument("--epochs", type=int, default=30)

    t = sub.add_parser("train")
    t.add_argument("--export", help="JSON file saved from GET /api/export")
    t.add_argument("--synthetic", action="store_true")
    t.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "out"))
    t.add_argument("--epochs", type=int, default=60)

    w = sub.add_parser("worker")
    w.add_argument("--interval", type=float, default=5.0)

    a = p.parse_args(argv)
    if a.cmd == "make-fixtures":
        from . import fixtures
        latest = fixtures.make_fixtures(Path(a.out), version=a.version, epochs=a.epochs)
        print("wrote", a.out)
        print(json.dumps(latest))
    elif a.cmd == "train":
        from . import data, pipeline
        if a.synthetic:
            ex = data.synthetic_export()
        elif a.export:
            ex = json.loads(Path(a.export).read_text(encoding="utf-8"))
        else:
            p.error("give --export FILE or --synthetic")
        res = pipeline.run(ex, static_epochs=a.epochs, motion_epochs=a.epochs)
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        for name, content in res.files.items():
            (out / name).write_bytes(content)
        (out / "meta.json").write_text(json.dumps(res.meta, indent=2), encoding="utf-8")
        print("static accuracy:", res.meta["val_accuracy"], "| motion accuracy:", res.meta.get("motion_val_accuracy"))
        print("skipped:", res.skipped or "nothing")
        print("wrote", out)
    elif a.cmd == "worker":
        from .client import Server
        from .worker import poll_forever
        poll_forever(Server(), a.interval)


if __name__ == "__main__":
    main()

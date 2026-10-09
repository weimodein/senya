"""python -m app.cli <command>

  make-fixtures   train dummy models on synthetic data, write fixtures/mock_server
  train           train from a dataset JSON file (GET /api/ml/dataset) or --synthetic, write a model folder
  run-job ID      train model version ID through the backend callbacks, without the HTTP trigger
                  (fallback when the backend can't reach this laptop; needs BACKEND_URL and ML_API_KEY)
"""
import argparse
import json
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]


def main(argv=None):
    load_dotenv()
    p = argparse.ArgumentParser(prog="app.cli")
    sub = p.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("make-fixtures")
    f.add_argument("--out", default=str(REPO / "fixtures" / "mock_server"))
    f.add_argument("--version", type=int, default=0)
    f.add_argument("--epochs", type=int, default=30)

    t = sub.add_parser("train")
    t.add_argument("--dataset", help="JSON file saved from GET /api/ml/dataset")
    t.add_argument("--synthetic", action="store_true")
    t.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "out"))
    t.add_argument("--epochs", type=int, default=60)

    r = sub.add_parser("run-job")
    r.add_argument("model_id", type=int)
    r.add_argument("--epochs", type=int, default=60)

    a = p.parse_args(argv)
    if a.cmd == "make-fixtures":
        from app.core import fixtures
        latest = fixtures.make_fixtures(Path(a.out), version=a.version, epochs=a.epochs)
        print("wrote", a.out)
        print(json.dumps(latest))
    elif a.cmd == "train":
        from app.core import data, pipeline
        if a.synthetic:
            ds = data.synthetic_export()
        elif a.dataset:
            ds = json.loads(Path(a.dataset).read_text(encoding="utf-8"))
        else:
            p.error("give --dataset FILE or --synthetic")
        res = pipeline.run(ds, static_epochs=a.epochs, motion_epochs=a.epochs)
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        for name, content in res.files.items():
            (out / name).write_bytes(content)
        (out / "meta.json").write_text(json.dumps(res.meta, indent=2), encoding="utf-8")
        print("static accuracy:", res.meta["val_accuracy"], "| motion accuracy:", res.meta.get("motion_val_accuracy"))
        print("skipped:", res.skipped or "nothing")
        print("wrote", out)
    elif a.cmd == "run-job":
        from app.services.backend_client import Backend
        from app.services.jobs import run_job
        run_job(Backend(), a.model_id, epochs=a.epochs)


if __name__ == "__main__":
    main()

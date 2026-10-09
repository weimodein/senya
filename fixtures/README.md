# Shared fixtures

**Owner: Person B.** Person A only reads from here.

Expected contents (see `CONTRACT.md` items 10–12):

| Path | Pushed by | Used by A for |
|---|---|---|
| `mock_server/` (`api/model/latest` + `models/v0/*`) | 1:00 | `SignClassifier`, `MotionClassifier`, golden-file test, `ModelRepository` |
| `segmenter_case.json` | 2:30 | `MotionSegmenter` fixture test |

Run the mock server: `cd fixtures/mock_server && python -m http.server 8000`

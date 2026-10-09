# MediaPipe model bundle

`app/services/extract.py` needs `hand_landmarker.task` in this folder. It is git-ignored; download it once:

```bash
curl -sSL -o app/models/hand_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
```

This is the same bundle the Android app ships (`android/app/src/main/assets/hand_landmarker.task`), so you can also copy it from there. Override the location with `HAND_LANDMARKER_MODEL`.

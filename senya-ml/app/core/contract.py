"""Constants from CONTRACT.md. Nothing else in the trainer redefines shapes or file names."""

POINTS = 21
FLOATS = POINTS * 3
FRAMES = 32
NONE_LABEL = "_none"

MODEL = "model.tflite"
LABELS = "labels.json"
GOLDEN = "golden.json"
MOTION_MODEL = "motion.tflite"
MOTION_LABELS = "motion_labels.json"
MOTION_CONFIG = "motion_config.json"
MOTION_GOLDEN = "motion_golden.json"

# motion_config.json defaults (contract §3 item 8). Speeds are in hand sizes per second.
MOTION_CONFIG_DEFAULT = {
    "T": FRAMES, "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200, "pad_ms": 150,
    "min_ms": 300, "max_ms": 2500, "max_missing": 0.25, "min_confidence": 0.7,
    "replace_window_ms": 1000, "start_shapes": {"J": ["I"], "Z": []},
}

# Training thresholds (spec §4.3). Motion clips are single takes (one movement each, raise and lower cut away
# into _none), so 3 clips activate a motion sign; 3 clips also yield about 6 _none cuts.
MIN_STATIC_SAMPLES = 30
MIN_MOTION_SEQUENCES = 3
MIN_MOTION_UPLOADS = 3
MIN_NONE_SEQUENCES = 6

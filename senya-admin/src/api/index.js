import api from "./client.js";

const data = (p) => p.then((r) => r.data);

export const auth = {
  login: (username, password) => data(api.post("/api/auth/login", { username, password })),
  me: () => data(api.get("/api/auth/me")),
};

export const signs = {
  list: () => data(api.get("/api/signs")),
  create: (body) => data(api.post("/api/signs", body)),
  update: (id, body) => data(api.patch(`/api/signs/${id}`, body)),
  remove: (id) => data(api.delete(`/api/signs/${id}`)),
  uploads: (id) => data(api.get(`/api/signs/${id}/uploads`)),
  samples: (id, limit = 60) => data(api.get(`/api/signs/${id}/samples`, { params: { limit } })),
  /** One file per request: the backend sends it to the ML service and waits for the landmarks. */
  upload: (id, file, onProgress) => {
    const form = new FormData();
    form.append("file", file);
    return data(
      api.post(`/api/signs/${id}/uploads`, form, {
        timeout: 240_000,
        onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
      }),
    );
  },
  removeUpload: (uploadId) => data(api.delete(`/api/uploads/${uploadId}`)),
};

/** Fired after anything that can change which version is live, so the sidebar's "On phones" stays current. */
export const MODELS_CHANGED = "senya:models-changed";
const changed = (p) => p.then((r) => (window.dispatchEvent(new Event(MODELS_CHANGED)), r));

export const models = {
  list: () => data(api.get("/api/models")),
  get: (id) => data(api.get(`/api/models/${id}`)),
  train: () => changed(data(api.post("/api/models/train"))),
  deploy: (id) => changed(data(api.post(`/api/models/${id}/deploy`))),
  remove: (id) => changed(data(api.delete(`/api/models/${id}`))),
};

// Training thresholds (spec §4.3): shown as readiness bars on the alphabet chart.
export const MIN_STATIC_SAMPLES = 30;
export const MIN_MOTION_SEQUENCES = 20;
export const MIN_NONE_SEQUENCES = 40;
export const targetFor = (sign) =>
  sign.kind === "static" ? MIN_STATIC_SAMPLES : sign.label === "_none" ? MIN_NONE_SEQUENCES : MIN_MOTION_SEQUENCES;

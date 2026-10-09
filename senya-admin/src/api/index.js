// Every backend call the panel makes (docs/architecture.md §5.2).
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
  samples: (id, limit = 48) => data(api.get(`/api/signs/${id}/samples`, { params: { limit } })),
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

export const models = {
  list: () => data(api.get("/api/models")),
  train: () => data(api.post("/api/models/train")),
  deploy: (id) => data(api.post(`/api/models/${id}/deploy`)),
  remove: (id) => data(api.delete(`/api/models/${id}`)),
};

// How much data a sign needs before it can be trained (spec §4.3). Motion signs: one movement per clip, 3 clips;
// _none also fills up from the raise and lower of those clips.
export const MIN_STATIC_SAMPLES = 30;
export const targetFor = (sign) => (sign.kind === "static" ? 30 : sign.label === "_none" ? 4 : 3);

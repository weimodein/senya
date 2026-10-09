# senya-admin

The Senya admin panel: React 19 + Vite 7 + Tailwind CSS 3. It talks only to `senya-backend` (see `docs/architecture.md`).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173, with senya-backend running on :8000
npm run build      # dist/, which senya-backend serves in production
```

## Where things are

The panel is split so the **look** can be redesigned without touching the **logic**.

| You want to change… | Edit | Notes |
|---|---|---|
| Colors, buttons, inputs, cards, badges, progress bars | `src/components/ui.jsx` | Every shared style is here. Change it once and every page follows. |
| The top bar / page frame | `src/components/Layout.jsx` | |
| What a page shows and how it's laid out | `src/pages/*.jsx` | Markup only. Pages read everything from a hook. |
| What data a page gets, or what a button does | `src/hooks/*.js` | `useSigns` (Signs page), `useSign` (one sign + upload queue), `useModels` (Models page) |
| API calls | `src/api/index.js` | The only file that knows backend URLs. |
| Login / session | `src/context/AuthContext.jsx`, `src/api/client.js` | JWT kept in `localStorage`, logged out on any 401. |

## What each hook gives a page

**`useSigns()`** → `{ signs, error, addSign({label, kind, startShapes}) }`
Each sign has `label`, `kind` (`static` | `motion`), `sample_count`, `target` (30 static, 20 motion, 40 `_none`) and `ready`.

**`useSign(id)`** → `{ sign, uploads, previews, queue, uploading, error, addFiles(files), clearQueue(), deleteUpload(id), saveStartShapes(text), deleteSign() }`
Queue items have `file`, `status` (`waiting` → `uploading` → `extracting` → `done` | `failed`), `result` and `error`. Files upload one at a time.

**`useModels()`** → `{ models, live, training, trainingStuck, readyLetters, canTrain, busy, error, train(), deploy(id), remove(id) }`
Model `status` is `training` | `trained` | `deployed` | `failed`. While one is training, the hook polls every 2 s.

Actions (`addSign`, `deploy`, …) return an error message, or `""` on success. Show it with `<ErrorText>`.

## Rules

- Keep backend calls in `src/api/index.js` and state in `src/hooks/`. Pages and components should only render.
- Errors from the backend are always `{ message }`; `errorMessage(err)` in `src/api/client.js` turns any failure into a sentence.

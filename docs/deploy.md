# Deploying Senya (Supabase + Render + laptop)

| Part | Runs on |
|---|---|
| Database | Supabase (PostgreSQL only, no storage buckets) |
| `senya-backend` + built `senya-admin` | one Render web service (`render.yaml`) |
| `senya-ml` | a laptop, reachable through an ngrok static domain |

## 1. Supabase
1. Create a project in the Singapore region.
2. **Connect → Direct → Session pooler.** Copy the URI (host `…pooler.supabase.com`, port `5432`) and put the database password in it. Do not use "Direct connection": it is IPv6-only and Render can't reach it.
3. Run no SQL by hand. The backend applies `senya-backend/migrations/*.sql` on every start, and the schema turns on row-level security so Supabase's public REST API can't touch the tables.

## 2. Secrets
Generate each with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`:
- `JWT_SECRET`: Render can generate this one.
- `ML_API_KEY`: the **same value** goes into Render and into `senya-ml/.env`.
- `ADMIN_PASSWORD`: what you type into the admin panel.

## 3. ML service on the laptop
1. `cd senya-ml && .venv\Scripts\activate && uvicorn app.main:app --port 8001`
2. Claim a free static domain on ngrok (dashboard → Domains), then run `ngrok http --url=<your-domain>.ngrok-free.app 8001`.
3. In `senya-ml/.env`, set `BACKEND_URL=https://<your-service>.onrender.com`.

Uploading clips and training need the laptop and the tunnel running. Translation on the phone never does. If the tunnel is down when someone clicks **Train**, the model row stays `training` and its message shows the command to finish it from the laptop: `python -m app.cli run-job <id>`.

## 4. Render
1. **New → Blueprint**, pick this repository. Render reads `render.yaml`.
2. Fill in `DATABASE_URL`, `ADMIN_PASSWORD`, `ML_API_KEY`, and `ML_SERVICE_URL=https://<your-domain>.ngrok-free.app`.
3. Deploy. When `/health` answers, open the service URL and log in.
4. Optional, for a first connection test: run `npm run seed:v0` once (locally, with the same `DATABASE_URL`) to publish the dummy v0 model.

Free web services sleep after ~15 minutes without traffic; the first request then takes about a minute. **Open the URL once before any demo.** The app keeps working from its bundled model while the server sleeps.

## 5. The app
Release builds use `https://senya.onrender.com`. To change it, set `senya.serverUrl=<url>` in `android/local.properties` before building. Debug builds can also override it in Settings.

## Never commit
`.env` files, the database password, `ML_API_KEY`, `JWT_SECRET`, `ADMIN_PASSWORD`.

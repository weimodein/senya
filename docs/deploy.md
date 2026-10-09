# Deploying Senya (Render + Supabase)

One Render web service runs the Express API and serves the built React page. Supabase hosts only the PostgreSQL database. The trainer (`ml/`) runs on a laptop and talks to the deployed URL.

## 1. Supabase (database)
1. Create a project. Pick a region near Render's (Singapore if you can).
2. **Project Settings → Database → Connection string → Session pooler** (not "Direct connection": Render cannot reach Supabase's IPv6-only direct host). Copy the URI and put your database password in it. It looks like `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
3. Do **not** run any SQL by hand. The server creates the tables when it starts (`platform/server/schema.sql`), and the schema turns on row-level security so Supabase's public REST API cannot read or write your data.

## 2. Render (server + web page)
1. **New → Blueprint**, pick this GitHub repo. Render reads `render.yaml`.
2. Set `DATABASE_URL` to the Supabase pooler URI. `ADMIN_TOKEN` is generated for you: open the service's **Environment** tab and copy it (you type it into the web page, and the trainer needs it).
3. Deploy. When `/health` answers, open the service URL, enter the admin token.

Free web services sleep after ~15 minutes without traffic, and the first request takes about a minute. **Before any demo, open the URL once to wake it.** The app keeps working from its bundled model if the server is asleep.

## 3. Point the trainer and the app at it
- Trainer: `SENYA_SERVER=https://<your-service>.onrender.com`, `SENYA_ADMIN_TOKEN=<the token>`, then `python -m senya_ml.cli worker` (from `ml/`, with its virtualenv).
- App: set the server URL in Settings (gear icon), or change `DEFAULT_SERVER_URL` in `ModelRepository.kt` before building the release APK.

## 4. Never commit
The admin token, the database password, and `.env` files.

# Deploying the App to Render (backend + Discord bot)

This is the full walkthrough for putting the **`doompify-app`** (backend API +
Discord bot) live on **Render**, reachable at **club.doomps.xyz**.

> The static home site (`swamp-club-home/`) does **not** go on Render — that
> stays on Cloudflare Pages. This guide is only for the app.

There are two ways to do it:

- **Path A — Blueprint (recommended):** Render reads the included `render.yaml`
  and sets up everything (service + persistent disk + env var prompts) in a few
  clicks.
- **Path B — Manual:** you create the service by hand in the dashboard.

Both run the backend **and** the Discord bot together in one service, because
they share one SQLite database file and a Render disk can only attach to one
service. (For a fully separated setup you'd swap SQLite for Postgres — see the
"Advanced" section at the end.)

---

## Before you start — gather these

You cannot finish without them, so collect them first:

- **A GitHub (or GitLab) account** — Render deploys from a git repo.
- **Alchemy API key** — https://dashboard.alchemy.com (Ethereum Mainnet app).
- **OpenSea API key** — https://docs.opensea.io.
- **Discord app credentials** — bot token, client ID, client secret, your
  server's guild ID, and the admin role id(s). Full steps are in
  **DISCORD-BOT.md**. Do that guide's Part A–C first.
- **Your DOOMPS collection contract address.**

---

## Step 1 — Put the app in a git repo

Render deploys from a repository. Push the **`doompify-app/`** folder to a new
repo so that `render.yaml`, `package.json`, and the `backend/ bot/ shared/ web/`
folders are all at the **repo root**.

```
# from inside the doompify-app folder:
cd doompify-app
git init
git add .
git commit -m "Swamp Club app"
# create an empty repo on GitHub, then:
git remote add origin https://github.com/YOURNAME/swampclub-app.git
git branch -M main
git push -u origin main
```

Confirm on GitHub that `render.yaml` and `package.json` sit at the top level of
the repo (not inside a subfolder). This matters — Render looks for `render.yaml`
at the root.

---

## Path A — Deploy with the Blueprint (recommended)

1. In Render, click **New +** → **Blueprint**.
2. Connect your GitHub account and pick the repo you just pushed.
3. Render detects `render.yaml` and shows one service (**swampclub**) with a
   **1 GB persistent disk** mounted at `/data`.
4. It will prompt you for the secret env vars (everything marked "sync:false").
   Paste in:
   - `DOOMPS_CONTRACT`
   - `ALCHEMY_API_KEY`
   - `OPENSEA_API_KEY`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_CLIENT_SECRET`
   - `DISCORD_BOT_TOKEN`
   - `DISCORD_GUILD_ID`
   - `ADMIN_ROLE_IDS`  (comma-separated role id(s))
   (`SESSION_SECRET` is auto-generated; the callback URLs are pre-filled.)
5. Click **Apply**. Render installs, runs the DB migration, and starts the
   service (backend + bot together).
6. Watch the **Logs** tab. You want to see, in order:
   - `[start-all] running database migration…`
   - `Migrated DB at /data/doompify.db`
   - `[start-all] registering slash commands…`
   - `Registered 6 guild commands…`
   - `... bot online as <name>`
   - `The Swamp Club backend on ... (port 4000)`

Then jump to **Step 3 (custom domain)** below.

> The blueprint uses the **Starter** plan because a persistent disk (needed for
> the database and uploaded memes) is not available on the Free plan. If you
> deploy on Free, data resets on every restart/deploy — fine for a quick test,
> not for production.

---

## Path B — Deploy manually (no blueprint)

1. **New +** → **Web Service** → connect the repo.
2. Settings:
   - **Root Directory:** leave blank (repo root).
   - **Runtime:** Node.
   - **Build Command:** `npm install`
   - **Start Command:** `node start-all.js`
     (the migration now runs automatically at startup, when the disk is
     mounted — you do not run it in the build step)
   - **Instance type:** Starter or higher (needed for a persistent disk).
3. **Add a disk:** in the service's **Disks** section, add one:
   - **Name:** `swampclub-data`
   - **Mount path:** `/data`
   - **Size:** 1 GB (raise later if you get lots of memes)
4. **Environment variables** — add each of these (Environment tab):

   | Key | Value |
   | --- | ----- |
   | `NODE_VERSION` | `20` |
   | `PORT` | `4000` |
   | `PUBLIC_URL` | `https://club.doomps.xyz` |
   | `BRAND_NAME` | `The Swamp Club` |
   | `DB_PATH` | `/data/doompify.db` |
   | `UPLOADS_DIR` | `/data/uploads` |
   | `ALCHEMY_NETWORK` | `eth-mainnet` |
   | `RECHECK_INTERVAL_MIN` | `360` |
   | `DOOMPS_CONTRACT` | your contract `0x...` |
   | `ALCHEMY_API_KEY` | your key |
   | `OPENSEA_API_KEY` | your key |
   | `DISCORD_CLIENT_ID` | your app id |
   | `DISCORD_CLIENT_SECRET` | your secret |
   | `DISCORD_BOT_TOKEN` | your bot token |
   | `DISCORD_GUILD_ID` | your server id |
   | `ADMIN_ROLE_IDS` | admin role id(s), comma-separated |
   | `SESSION_SECRET` | a long random string |
   | `DISCORD_REDIRECT_URI` | `https://club.doomps.xyz/auth/discord/callback` |
   | `USER_REDIRECT_URI` | `https://club.doomps.xyz/auth/user/callback` |
   | `ADMIN_REDIRECT_URI` | `https://club.doomps.xyz/admin/api/callback` |

5. **Create Web Service.** Render builds and starts it. Check the logs for the
   same success lines listed in Path A step 6.

---

## Step 3 — Point club.doomps.xyz at the service

1. In the Render service, open **Settings → Custom Domains → Add Custom Domain**.
2. Enter `club.doomps.xyz`. Render shows a target value (a
   `something.onrender.com` hostname).
3. In **Cloudflare DNS** (where doomps.xyz is managed), add a **CNAME**:
   - **Name:** `club`
   - **Target:** the `onrender.com` hostname Render gave you
   - **Proxy status:** DNS only (grey cloud) is simplest to start; Render issues
     its own TLS cert. (You can switch to proxied later if you prefer.)
4. Wait for Render to show the domain as **Verified / Certificate Issued**
   (usually a few minutes). Now `https://club.doomps.xyz` serves the app.

---

## Step 4 — Register the Discord OAuth redirect URLs

In the Discord Developer Portal → your app → **OAuth2 → Redirects**, add all
three (they must match the env values exactly):

```
https://club.doomps.xyz/auth/discord/callback
https://club.doomps.xyz/auth/user/callback
https://club.doomps.xyz/admin/api/callback
```

Save. Without these, logging in / linking wallets on the site will error.

---

## Step 5 — First-run setup

1. Visit `https://club.doomps.xyz/admin/` and log in with Discord (you must hold
   an `ADMIN_ROLE_IDS` role).
2. **Role rules:** map holdings → roles (e.g. 1 DOOMPS → Holder, 5 → Whale).
3. **Memematic 3000 prizes:** set the Big/Medium/Small/Tiny labels.
4. **Channels:** the Swamp chat auto-seeds (announcements, giveaways, general,
   memes, trading). Adjust in the panel.
5. Test the bot in Discord: `/verify 0x...`, paste the code into your OpenSea
   bio, `/confirm`. Confirm a role is granted.

Then open `https://doomps.xyz` and click through Verify / The Swamp / Memematic
3000 / Gallery to confirm the home site reaches the app.

---

## How this maps to what runs

```
Render "swampclub" web service (Starter, 1GB disk at /data)
 ├─ node start-all.js
 │   ├─ registers slash commands (once per boot)
 │   ├─ starts the Discord bot        (verification + role sync)
 │   └─ starts the backend API/web    (Verify, Swamp chat, Memematic, Gallery)
 └─ /data (persistent disk)
     ├─ doompify.db     ← SQLite database
     └─ uploads/        ← uploaded memes + chat images
```

---

## Troubleshooting Render

| Symptom | Fix |
| ------- | --- |
| Build fails on `better-sqlite3` | Ensure `NODE_VERSION=20` (or 18/20). It's a native module Render compiles at build; a mismatched Node can break it. |
| `migrate failed with error code 1` in build | Old build command ran `npm run migrate` before env/disk were ready. Fixed: migration now runs at **startup** via `start-all.js`. Set Build Command to just `npm install` and Start Command to `node start-all.js`. |
| App boots but data resets each deploy | You're on Free (no disk) or `DB_PATH`/`UPLOADS_DIR` aren't set to `/data/...`. Use Starter + the disk, and point both at `/data`. |
| "Cannot find module @doompify/shared" | The repo must include `package.json` (workspaces) at the root and the `shared/` folder. Confirm they're pushed. |
| Bot online but no roles assigned | Bot's role is below the target role in Discord, or `ADMIN_ROLE_IDS`/rules not set. See DISCORD-BOT.md. |
| OAuth/login errors | The three redirect URLs aren't registered in Discord, or `PUBLIC_URL` doesn't match `club.doomps.xyz`. |
| Uploads fail for big images | Raise the disk size and note the 8 MB upload cap (`MAX_UPLOAD_BYTES`). Render's proxy allows large bodies by default. |
| Domain stuck "unverified" | Re-check the Cloudflare CNAME points to the exact `onrender.com` target; set it to DNS-only (grey cloud) while verifying. |

---

## Advanced: run the bot as a separate service

The bundled setup runs bot + backend together because they share a local SQLite
file. If you want them as **two independent Render services** (e.g. to scale or
restart them separately), switch the database from SQLite to **Postgres**:

1. Create a **Render Postgres** instance.
2. Replace the storage layer in `shared/db.js` with a Postgres client (the query
   surface is small and centralized there).
3. Then deploy two services — a **Web Service** (`npm start --workspace backend`)
   and a **Background Worker** (`npm start --workspace bot`) — both reading
   `DATABASE_URL`. No disk needed.

This is more work but removes the single-process coupling. For most communities
the combined single-service setup is simpler and perfectly fine.

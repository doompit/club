# The Swamp Club — Complete Bundle

This bundle contains **two pieces** that together make up doomps.xyz:

```
swamp-club-bundle/
├── swamp-club-home/     ← the public marketing site (static HTML/CSS/JS)
│                          deploys to:  doomps.xyz
└── doompify-app/        ← the app: Verify, The Swamp chat, Memematic 3000,
                           meme Gallery + Discord bot (Node.js backend)
                           deploys to:  club.doomps.xyz
```

They are deployed **separately** to two different places, because they are two
different kinds of thing:

- **`swamp-club-home`** is a static site → goes on Cloudflare Pages (or any
  static host). No server, no build.
- **`doompify-app`** is a Node.js server with a database, file uploads, and a
  Discord bot → needs a real server/VPS or a Node host (Railway, Render, Fly,
  a VPS, etc.). It cannot go on Cloudflare Pages.

The home site links to the app; the app links back. Once both are live at their
domains, the whole thing works as one experience.

---

# PART 1 — Deploy the home site (doomps.xyz)

**What it is:** 3 static pages (Home, The Portal, DOOMP Lore) + images.
**Where it goes:** `doomps.xyz` on Cloudflare Pages (your current setup).

### Steps
1. In your Cloudflare Pages project for doomps.xyz, upload/replace the contents
   of `swamp-club-home/` (index.html, portal.html, lore.html, and the img/
   folder).
2. That's it — no build command, no environment variables. Cloudflare serves
   the files directly.

### What these pages link to
The nav and footers point at the app on `club.doomps.xyz`:

    Verify          → https://club.doomps.xyz/
    The Swamp chat  → https://club.doomps.xyz/chat
    Memematic 3000  → https://club.doomps.xyz/memematic
    Gallery         → https://club.doomps.xyz/gallery

So those links only work once PART 2 is live at club.doomps.xyz. Until then the
home site still loads fine; those buttons just won't resolve yet.

---

# PART 2 — Deploy the app (club.doomps.xyz)

**What it is:** the Doompify backend (Express + SQLite + file uploads) that
serves the Verify page, The Swamp chat, the Memematic 3000 game, and the meme
Gallery — plus a Discord bot for holder verification/roles.
**Where it goes:** a Node.js host at `club.doomps.xyz`. NOT Cloudflare Pages.

The clean routes `/chat`, `/memematic`, `/gallery` are already handled by the
backend (see `backend/src/server.js`), so no extra redirect config is needed —
just run the server.

## 2a. Prerequisites (get these first)

- **Node.js 18+** on the host.
- **Alchemy API key** — https://dashboard.alchemy.com (Ethereum Mainnet app).
- **OpenSea API key** — https://docs.opensea.io.
- **A Discord application + bot** — https://discord.com/developers:
  - Create an app, add a **Bot**, copy the **bot token**.
  - Copy the **Client ID** and **Client Secret** (OAuth2 page).
  - Bot needs the **Manage Roles** permission, and in your server its role must
    sit **above** any role it will assign.
  - Add these OAuth redirect URLs (OAuth2 → Redirects), using your real domain:
    - `https://club.doomps.xyz/auth/discord/callback`   (wallet linking)
    - `https://club.doomps.xyz/auth/user/callback`      (website login)
    - `https://club.doomps.xyz/admin/api/callback`       (admin login)
  - Get your **Guild (server) ID** and the **role id(s)** allowed to admin the
    panel (enable Developer Mode in Discord → right-click → Copy ID).
- **The DOOMPS collection contract address** (gates uploads + spins).

## 2b. Configure

There are two services in `doompify-app/`: `backend/` and `bot/`. Each has its
own `.env`.

```
cd doompify-app/backend
cp .env.example .env
# open .env and fill in every value (see notes below)

cd ../bot
cp .env.example .env
# fill this in too — point DB_PATH at the SAME file as the backend
```

Key values in `backend/.env`:

    PORT=4000
    PUBLIC_URL=https://club.doomps.xyz
    BRAND_NAME=The Swamp Club
    DB_PATH=../data/doompify.db
    DOOMPS_CONTRACT=0x...             # your collection contract
    UPLOADS_DIR=../data/uploads
    ALCHEMY_API_KEY=...
    OPENSEA_API_KEY=...
    DISCORD_CLIENT_ID=...
    DISCORD_CLIENT_SECRET=...
    DISCORD_BOT_TOKEN=...
    DISCORD_GUILD_ID=...
    DISCORD_REDIRECT_URI=https://club.doomps.xyz/auth/discord/callback
    USER_REDIRECT_URI=https://club.doomps.xyz/auth/user/callback
    ADMIN_REDIRECT_URI=https://club.doomps.xyz/admin/api/callback
    ADMIN_ROLE_IDS=...               # comma-separated Discord role id(s)
    SESSION_SECRET=<long random string>

`bot/.env` reuses the same keys (ALCHEMY, OPENSEA, DISCORD_BOT_TOKEN,
DISCORD_CLIENT_ID, DISCORD_GUILD_ID) and the **same** DB_PATH.

## 2c. Install & run

The project uses a small local "shared" package that backend and bot both
depend on (referenced as `@doompify/shared`). Install each service:

```
# backend
cd doompify-app/backend
npm install
npm run migrate        # creates the SQLite database + tables
npm start              # starts the server on PORT (default 4000)

# bot (in a second terminal / process)
cd doompify-app/bot
npm install
npm run register       # registers the slash commands with your Discord server
npm start              # starts the bot
```

For production, run both under a process manager (pm2, systemd, or your host's
process runner) so they stay up and restart on crash. Example with pm2:

```
npm install -g pm2
cd doompify-app/backend && pm2 start "npm start" --name swampclub-api
cd ../bot && pm2 start "npm start" --name swampclub-bot
pm2 save
```

## 2d. Put it on club.doomps.xyz

The backend listens on a port (default 4000). Point `club.doomps.xyz` at it:

1. Run a reverse proxy (nginx/Caddy) that terminates HTTPS for
   `club.doomps.xyz` and forwards to `http://localhost:4000`.
2. In Cloudflare DNS, add an **A record** for `club` → your server's IP
   (proxied is fine). Make sure HTTPS is on (Cloudflare provides the cert; your
   proxy can also use Let's Encrypt / Caddy auto-TLS).

Caddy example (handles HTTPS automatically):

```
club.doomps.xyz {
    reverse_proxy localhost:4000
}
```

nginx example (behind Cloudflare TLS or with certbot):

```
server {
    server_name club.doomps.xyz;
    client_max_body_size 10M;         # allow meme/image uploads
    location / { proxy_pass http://localhost:4000; proxy_set_header Host $host; }
}
```

> `client_max_body_size` matters — uploads default to 8 MB; set the proxy limit
> at or above that or large memes will fail.

## 2e. First-run setup in the app

1. Visit `https://club.doomps.xyz/admin/` and log in with Discord (you must hold
   one of the `ADMIN_ROLE_IDS`).
2. Set the **role rules** (which holdings grant which Discord roles).
3. Set the **Memematic 3000 prize labels** (Big/Medium/Small/Tiny). Odds are
   fixed at 5/10/15/20 with a 50% rug.
4. Channels for **The Swamp** chat are auto-seeded (announcements, giveaways,
   general, memes, trading). Adjust or add channels in the admin panel.

---

# How the two pieces fit together

```
   doomps.xyz  (static home / The Swamp Club)
        │  nav + buttons link to ↓
        ▼
   club.doomps.xyz  (the app)
        /            → Verify (Doompify)
        /chat        → The Swamp (chat)
        /memematic   → Memematic 3000
        /gallery     → meme Gallery
        /admin/      → admin panel (role rules, prizes, channels, payouts)
   + Discord bot running alongside the backend
```

Both share the same DOOMPS holder verification: a user proves they hold DOOMPS
by pasting a short code (`doomp:xxxx`) into their OpenSea bio — no wallet
connect. That unlocks uploading memes, the daily spin, and posting in
holder-gated channels.

---

# Quick checklist

- [ ] Home site uploaded to Cloudflare Pages (doomps.xyz)
- [ ] Alchemy + OpenSea API keys obtained
- [ ] Discord app created; bot token, client id/secret, guild id, admin role ids
- [ ] 3 Discord OAuth redirect URLs added (callback URLs above)
- [ ] backend/.env and bot/.env filled in (same DB_PATH)
- [ ] `npm install` + `npm run migrate` + `npm start` (backend)
- [ ] `npm install` + `npm run register` + `npm start` (bot)
- [ ] Reverse proxy + DNS pointing club.doomps.xyz → the server
- [ ] Logged into /admin/, set role rules + prizes
- [ ] Clicked through home → Verify / Swamp / Memematic / Gallery to confirm

Detailed app internals are in `doompify-app/README.md`.
Home-site notes are in `swamp-club-home/README.md`.
**Full Discord bot setup + verification walkthrough is in `DISCORD-BOT.md`.**
**Step-by-step Render deployment (backend + bot) is in `RENDER.md`.**

# Discord Verification Bot — Setup & How It Works

This guide covers the Discord bot that verifies DOOMPS holders and assigns
roles. It lives in `doompify-app/bot/` and runs alongside the backend, sharing
the same database.

---

## What the bot does

The bot proves a Discord member holds DOOMPS **without any wallet connection** —
no signing, no seed phrase, no WalletConnect. Instead:

1. The member runs `/verify <their 0x address>` in your server.
2. The bot gives them a short one-time code, e.g. **`doomp:Zk9mQ2aB`**.
3. They paste that code into their **OpenSea profile bio** and save it.
4. They run `/confirm`. The bot reads their OpenSea bio, sees the code, and now
   knows they control that wallet.
5. The bot checks (via Alchemy) whether that wallet holds DOOMPS, and assigns
   the Discord roles you configured in the admin panel.
6. After verifying, they can remove the code from their bio — holdings are
   re-checked on-chain, not via the bio.

Only the real owner of an OpenSea account can edit its bio, so putting the code
there proves control of the wallet. That's the whole trick.

The bot also **re-checks holdings on a schedule** and removes roles from anyone
who no longer holds (e.g. they sold). Default: every 360 minutes (6 hours), set
by `RECHECK_INTERVAL_MIN`.

---

## Slash commands (what members use)

| Command             | What it does                                             |
| ------------------- | ------------------------------------------------------- |
| `/verify <address>` | Start verifying a wallet. Run again to add more wallets. |
| `/confirm`          | Confirm after pasting the code into your OpenSea bio.   |
| `/wallets`          | List the wallets you've linked.                         |
| `/unlink <address>` | Remove a linked wallet (re-syncs your roles).           |
| `/sync`             | Re-check your holdings now and refresh your roles.      |
| `/status`           | Show your verification status.                          |

Multiple wallets pool together — if role rules need "5 DOOMPS" and a member
holds 3 in one wallet and 2 in another, they qualify.

---

## Part A — Create the Discord application & bot

1. Go to **https://discord.com/developers/applications** and click
   **New Application**. Name it (e.g. "Swamp Club Verify"). Create.
2. Copy the **Application ID** from the General Information page —
   this is your `DISCORD_CLIENT_ID`.
3. On the same page, under **OAuth2**, copy the **Client Secret** (click Reset
   Secret if needed) — this is `DISCORD_CLIENT_SECRET`. (Used by the website /
   admin login, not by the bot's slash commands, but the app needs it.)
4. Go to the **Bot** tab → the bot exists by default on new apps (or click Add
   Bot). Click **Reset Token** and copy it — this is your `DISCORD_BOT_TOKEN`.
   **Keep this secret.** Anyone with it controls your bot.
5. Still on the Bot tab, scroll to **Privileged Gateway Intents**. This bot does
   **not** require any privileged intents (no Message Content, no Presence, no
   Server Members) — it only uses slash commands and role management. Leave them
   off.

## Part B — Bot permissions & inviting it to your server

1. Go to **OAuth2 → URL Generator**.
2. Under **Scopes**, check:
   - `bot`
   - `applications.commands`
3. Under **Bot Permissions**, check:
   - **Manage Roles**  (required — to assign/remove holder roles)
   - **Send Messages**  (for command replies)
   - **View Channels**
4. Copy the generated URL at the bottom, open it, and invite the bot to your
   server.

### Critical: role hierarchy
In **Server Settings → Roles**, drag the **bot's own role above** every role it
will assign. Discord will not let a bot assign a role that sits higher than its
own role. If verification "succeeds" but no role appears, this is almost always
why.

## Part C — Get the IDs you need

Enable Developer Mode: **Discord Settings → Advanced → Developer Mode ON**.
Then right-click to copy IDs:

- **Server (Guild) ID** — right-click your server name → Copy Server ID →
  this is `DISCORD_GUILD_ID`.
- **Admin role id(s)** — Server Settings → Roles → right-click a role → Copy
  Role ID. These go in the backend's `ADMIN_ROLE_IDS` (who may open the admin
  panel). Comma-separate multiple.
- The **holder role(s)** you want to grant — create them (e.g. "Holder",
  "Whale"), copy their IDs. You'll assign these to holdings in the admin panel,
  not in a config file.

---

## Part D — Configure the bot

In `doompify-app/bot/`:

```
cp .env.example .env
```

Fill in `bot/.env`:

```
DB_PATH=../data/doompify.db      # MUST be the same file the backend uses
BRAND_NAME=The Swamp Club

ALCHEMY_API_KEY=your_alchemy_key
ALCHEMY_NETWORK=eth-mainnet
OPENSEA_API_KEY=your_opensea_key

DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_app_client_id
DISCORD_GUILD_ID=your_guild_id

RECHECK_INTERVAL_MIN=360         # re-check holdings every 6 hours
```

> `DB_PATH` must point at the **same** SQLite file as the backend's `.env`.
> The bot and backend share one database — that's how a wallet verified via
> the website also counts in Discord, and vice versa.

---

## Part E — Register commands & run

```
cd doompify-app/bot
npm install
npm run register     # pushes the 6 slash commands to your server (run once,
                     #  and again whenever commands change)
npm start            # starts the bot; it logs in and begins the re-check loop
```

`npm run register` registers the commands to the single guild in
`DISCORD_GUILD_ID`, so they appear immediately (guild commands don't have the
~1 hour global propagation delay).

For production, keep it running with a process manager:

```
pm2 start "npm start" --name swampclub-bot
pm2 save
```

---

## Part F — Set what holders get (admin panel)

The bot doesn't hardcode which roles to grant — you define that in the app's
admin panel at `https://club.doomps.xyz/admin/`:

1. Log in with Discord (you must hold an `ADMIN_ROLE_IDS` role).
2. Open **Role rules** and add rules like:
   - DOOMPS contract, min 1 held → **Holder** role
   - DOOMPS contract, min 5 held → **Whale** role
3. Save. From then on, `/confirm`, `/sync`, and the scheduled re-check all use
   these rules.

---

## How it connects to the website

The bot and the website share the database, so a member can verify **either**
way and it counts everywhere:

- **In Discord:** `/verify` → `/confirm` (this bot).
- **On the site:** the Verify page at `club.doomps.xyz/` does the same OpenSea-bio
  check, then links their wallet via Discord login.

Either path unlocks the same things: holder roles in Discord, meme uploads, the
daily Memematic 3000 spin, and posting in holder-gated Swamp channels.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| Slash commands don't appear | `npm run register` not run, or wrong `DISCORD_GUILD_ID`. Re-run register; refresh Discord (Ctrl+R). |
| "Verified" but no role given | Bot's role is **below** the target role. Move the bot's role up in Server Settings → Roles. |
| Bot can't assign roles at all | Missing **Manage Roles** permission. Re-invite with the correct OAuth URL. |
| `/confirm` says code not found | The code must be in the **OpenSea bio** exactly, and saved. Check for extra spaces; re-copy from `/verify`. |
| Holdings show 0 for a real holder | Wrong `DOOMPS_CONTRACT` (backend `.env`) or wrong `ALCHEMY_NETWORK`. Verify the contract address and that it's `eth-mainnet`. |
| Roles never get revoked after selling | Bot not running, or `RECHECK_INTERVAL_MIN` very high. The sweep only runs while the bot process is up. |
| Website login works but Discord doesn't (or vice versa) | `DB_PATH` differs between backend and bot. Point both at the same file. |

---

## Security notes

- The **bot token** is a full credential — never commit it, never share it. If
  it leaks, Reset Token immediately in the Developer Portal.
- The verification code (`doomp:xxxx`) is single-use, tied to one wallet, and
  expires in 30 minutes.
- The bot only ever adds/removes the roles named in your rules — it never
  touches other roles.

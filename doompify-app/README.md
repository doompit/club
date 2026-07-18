# Doompify — Multi-Wallet NFT Holder Verification

Verify that a Discord user controls one or more Ethereum wallets **and** holds
NFTs from your collections — **without any wallet connection or signature**.
Proof of control is done DOOMPS/Signet-style: the user pastes a unique challenge
string into each wallet's **OpenSea profile bio**, and the backend confirms it.

Roles are granted from **pooled holdings across all of a member's linked
wallets**, according to rules an admin defines per collection.

## How verification works

```
1. User starts verification for a wallet (web page or Discord /verify <address>).
2. Backend issues a short challenge bound to that wallet:  doomp:<nonce>  (e.g. doomp:Zk9mQ2aB)
   (challenge prefix is defined in shared/challenge.js)
3. User pastes the challenge into that wallet's OpenSea bio and saves.
4. User seals it (web "Seal" button / Discord /confirm).
5. Backend reads the wallet's OpenSea bio and checks the string is present
   -> proves control (only the owner can edit that bio).
6. Repeat for as many wallets as they want — each is sealed independently.
7. Web: link Discord via OAuth. Bot: already linked. All sealed wallets attach
   to the Discord account.
8. Backend/bot pools NFT counts across all linked wallets (via Alchemy) and
   applies role rules: e.g. "≥1 of Collection A → Holder", "≥5 → Whale".
9. A periodic sweep re-checks holdings and revokes roles that no longer qualify.
```

No private keys, no signatures, no wallet-connect.

## Features

- **Multi-wallet**: link many wallets to one Discord user; holdings pool together.
- **Multi-collection role rules**: per-collection thresholds mapped to roles.
- **Admin panel**: Discord-OAuth login, gated to members holding an admin role
  in your server. Create/remove rules and pick roles from a live role list.
- **Bio-based control proof**: no wallet connection needed.
- **Auto re-sync**: periodic sweep revokes roles when holdings drop.

## Services (run separately)

| Dir        | What it is                              | Runs on            |
|------------|-----------------------------------------|--------------------|
| `backend/` | REST API + web verifier + admin panel   | Node/Express :4000 |
| `bot/`     | discord.js bot (slash commands + sweep) | gateway connection |
| `web/`     | Static frontend (`public/`) + `admin/`  | served by backend  |
| `shared/`  | Verification + pooled-holdings logic    | imported package   |

Backend and bot share one SQLite DB file (point both `DB_PATH` at the same path),
or swap `shared/db.js` for Postgres.

## Setup

1. `cp backend/.env.example backend/.env` and fill it in.
2. `cp bot/.env.example bot/.env` and fill it in (same DB_PATH + keys).
3. Backend: `cd backend && npm install && npm run migrate && npm start`
4. Bot: `cd bot && npm install && npm run register && npm start`
5. Verifier: `http://localhost:4000`  ·  Admin: `http://localhost:4000/admin/`

## Required credentials

- **Alchemy API key** — https://dashboard.alchemy.com (Ethereum Mainnet app).
- **OpenSea API key** — https://docs.opensea.io (reads account bio).
- **Discord application** — https://discord.com/developers:
  - Bot with **Manage Roles**; its role must sit **above** every role it grants.
  - OAuth redirect URIs:
    - `http://localhost:4000/auth/discord/callback` (user linking)
    - `http://localhost:4000/admin/api/callback` (admin login)
  - Set `ADMIN_ROLE_IDS` to the role id(s) allowed to manage rules
    (and/or `ADMIN_OWNER_ID`).

## Slash commands

- `/verify <address>` — start verifying a wallet (repeat for more wallets)
- `/confirm` — seal the most recent wallet after editing its OpenSea bio
- `/wallets` — list your linked wallets
- `/unlink <address>` — remove a wallet (re-syncs roles)
- `/sync` — re-check holdings and refresh roles
- `/status` — show your verification status

## Admin: role rules

Each rule = **collection contract + minimum pooled count → Discord role**.
Stack tiers for one collection (1 → Holder, 5 → Whale) and mix collections
freely. Members get every role whose threshold their pooled holdings meet.

## Design

The interface is the DOOMPS/Signet system: aged-parchment ink on deep
oxblood-black, a brass signet sigil, Fraunces + Space Mono, and a wax-seal
"inscription" motif. The admin panel shares the same tokens (`web/public/styles.css`
plus `web/admin/admin.css`).

## Security notes

- Challenge nonces expire (30 min) and are single-use.
- An address can only be claimed by one member per guild (conflicts are reported).
- The re-check sweep skips revocation on transient API errors.
- The system only ever adds/removes roles that appear in your rules; it never
  touches other roles.
- Admin sessions are short-lived signed cookies; admin status is re-checked at
  login against live Discord role membership.

---

## The Swamp: Memes + Memematic 3000

Added on top of verification:

### Meme gallery + upload (`/swamp.html#gallery`)
- **Holders only** can upload (gated by pooled DOOMPS holdings across their
  linked wallets — reuses verification). Set `DOOMPS_CONTRACT` in the backend env.
- Memes **auto-publish** to the gallery immediately. Files land in `UPLOADS_DIR`
  (default `../data/uploads`), served at `/uploads/...`.
- Accepted: PNG, JPG, GIF, WEBP up to `MAX_UPLOAD_BYTES` (default 8 MB).
- Admins can **delete** any meme from the admin panel (soft-delete + file removal).

### Memematic 3000 wheel (`/swamp.html#memematic`)
- **One spin per holder per UTC day.** Uploading at least one meme unlocks the
  day's spin; holder status is re-checked at spin time.
- **Fixed odds (one shot/day):** Big 5% · Medium 10% · Small 15% · Tiny 20% ·
  **Rug 50%** (RUGGED animation — carpet yank + falling swamp monster).
- The wheel face shows many crypto-flavored segments (WAGMI, REKT, MOON, NGMI,
  …) but every segment maps to one weighted outcome, so the real odds never
  change regardless of how the wheel is drawn.
- **Outcomes are resolved server-side** and persisted with a
  `UNIQUE(discord_id, day_key)` guard — the client animation just lands on the
  segment the server already chose. No client-side odds, no double-spins.

### Website login
- The site identifies visitors via Discord OAuth (`/auth/user/login`), separate
  from admin login. Uploads and spins are tied to that Discord user, and their
  holder status is checked against wallets they linked during verification.

### Admin additions (`/admin/`)
- **Prize editor:** rename the four winning tiers (Big/Medium/Small/Tiny). Odds
  are fixed and intentionally not editable.
- **Gallery moderation:** browse and delete uploaded memes.

### New env vars (backend)
```
DOOMPS_CONTRACT=0x...        # collection that gates uploads + spins
UPLOADS_DIR=../data/uploads
MAX_UPLOAD_BYTES=8388608
USER_REDIRECT_URI=http://localhost:4000/auth/user/callback
```
Add a third Discord OAuth redirect URI for the website login:
`http://localhost:4000/auth/user/callback`.

### New dependency
- `multer` (multipart upload parsing) — added to `backend/package.json`.

---

## The Swamp (on-site chat) + winner payouts

### The Swamp — Discord-style chat (`/chat.html`)
- **Channels grouped by category** (INFO, SWAMP, …), created and configured from
  the admin panel. A default set is seeded on first run (announcements,
  giveaways, general, memes, trading).
- **Near-real-time** via polling every ~3s (pauses when the tab is hidden).
- **Messages**: text + one image (PNG/JPG/GIF/WEBP), stored under
  `UPLOADS_DIR/chat`, served at `/uploads/chat/...`.
- **Reactions**: a fixed emoji set, toggled per user, aggregated with counts.
- **Per-channel role permissions**:
  - `read_roles`: empty = everyone (incl. logged-out); `["__admin__"]` = admins
    only; `["roleId", …]` = holders of those roles (admins always allowed).
  - `post_roles`: empty = any current holder; `["__admin__"]` = admins only;
    `["roleId", …]` = holders of those roles. Posting **always** requires being
    a current DOOMPS holder (admins excepted). Announcements/giveaways default to
    read-all / post-admin.
- **Holder + role checks reuse Doompify**: roles come from `role_grants` (assigned
  by holdings), holder status is checked live via Alchemy, admin status via the
  Discord admin-role check. All permission decisions are enforced **server-side**.
- Authors and admins can delete messages.

### Winner payouts (Memematic 3000)
- After a **winning** spin, the site prompts the winner for the wallet address to
  send the prize to (`POST /api/spin/claim`). Rugs get no prompt.
- The claim is stored on the spin row (`payout_address`, `payout_status=pending`).
- **Admin → Payouts** lists winners, shows their wallet + prize, and lets you
  **Mark paid** once sent. Filter by unpaid.

### Admin additions
- **Channels**: create channels (category, name, topic), set read/post permission
  from a dropdown (Everyone / Admins only / a specific role), and delete channels
  (removes their messages).
- **Payouts**: winner list with wallet addresses and a paid toggle.

### New/again env vars
No new required env beyond the meme/spin set. Chat images reuse `UPLOADS_DIR`
(subfolder `chat/`) and `MAX_UPLOAD_BYTES`.

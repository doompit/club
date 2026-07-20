import Database from "better-sqlite3";

/**
 * Doompify shared store. Both backend and bot open the same file.
 *
 * Model (multi-wallet + multi-collection):
 *   challenges  - open verification attempts for a single wallet
 *   wallets     - verified wallet <-> discord_id links (many wallets per user)
 *   role_rules  - admin-defined: collection contract + min pooled count -> role
 *   role_grants - which role a user currently holds (for reconciliation)
 */
export function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS challenges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      address     TEXT NOT NULL,
      nonce       TEXT NOT NULL,
      discord_id  TEXT,
      guild_id    TEXT,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL,
      consumed    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_ch_addr  ON challenges(address);
    CREATE INDEX IF NOT EXISTS idx_ch_nonce ON challenges(nonce);

    CREATE TABLE IF NOT EXISTS wallets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id  TEXT NOT NULL,
      guild_id    TEXT NOT NULL,
      address     TEXT NOT NULL,
      verified_at INTEGER NOT NULL,
      UNIQUE(guild_id, address)          -- an address can't be claimed twice in a guild
    );
    CREATE INDEX IF NOT EXISTS idx_w_user ON wallets(discord_id, guild_id);

    CREATE TABLE IF NOT EXISTS role_rules (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id       TEXT NOT NULL,
      collection     TEXT NOT NULL,     -- contract address (lowercase)
      collection_name TEXT,
      min_count      INTEGER NOT NULL DEFAULT 1,
      role_id        TEXT NOT NULL,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rr_guild ON role_rules(guild_id);

    CREATE TABLE IF NOT EXISTS role_grants (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id  TEXT NOT NULL,
      guild_id    TEXT NOT NULL,
      role_id     TEXT NOT NULL,
      granted_at  INTEGER NOT NULL,
      UNIQUE(discord_id, guild_id, role_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rg_user ON role_grants(discord_id, guild_id);

    -- Memes uploaded by holders (auto-shown; admin can delete).
    CREATE TABLE IF NOT EXISTS memes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id  TEXT NOT NULL,
      username    TEXT,
      filename    TEXT NOT NULL,       -- stored file on disk
      caption     TEXT,
      created_at  INTEGER NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_meme_new ON memes(deleted, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_meme_user ON memes(discord_id);

    -- One spin per holder per UTC day. day_key = 'YYYY-MM-DD'.
    CREATE TABLE IF NOT EXISTS spins (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id  TEXT NOT NULL,
      day_key     TEXT NOT NULL,
      outcome     TEXT NOT NULL,       -- big|medium|small|tiny|rug
      label       TEXT,                -- the crypto-flavored segment label shown
      prize_label TEXT,                -- resolved prize label at spin time (wins only)
      payout_address TEXT,             -- wallet the winner asked us to send to
      payout_status  TEXT NOT NULL DEFAULT 'none', -- none|pending|paid
      username    TEXT,                -- for admin display
      created_at  INTEGER NOT NULL,
      UNIQUE(discord_id, day_key)
    );
    CREATE INDEX IF NOT EXISTS idx_spin_user ON spins(discord_id);
    CREATE INDEX IF NOT EXISTS idx_spin_payout ON spins(payout_status);

    -- Editable prize labels for the 4 winning tiers (single row per guild).
    CREATE TABLE IF NOT EXISTS prize_config (
      tier        TEXT PRIMARY KEY,    -- big|medium|small|tiny
      label       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    -- ===== The Swamp: on-site Discord-style chat =====
    -- Channels grouped by category. Permissions are role-gated:
    --   read_roles / post_roles are JSON arrays of Discord role ids.
    --   Empty read_roles = everyone (incl. logged-out) can read.
    --   Empty post_roles = any logged-in holder can post.
    CREATE TABLE IF NOT EXISTS channels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id    TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'general',
      name        TEXT NOT NULL,       -- slug-ish, e.g. 'announcements'
      topic       TEXT,
      read_roles  TEXT NOT NULL DEFAULT '[]',
      post_roles  TEXT NOT NULL DEFAULT '[]',
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ch_guild ON channels(guild_id, position);

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  INTEGER NOT NULL,
      discord_id  TEXT NOT NULL,
      username    TEXT,
      body        TEXT,                -- text (may be empty if image-only)
      image       TEXT,                -- uploaded filename, nullable
      reply_to    INTEGER,             -- message id this replies to, nullable
      created_at  INTEGER NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_msg_channel ON messages(channel_id, id);

    CREATE TABLE IF NOT EXISTS reactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id  INTEGER NOT NULL,
      discord_id  TEXT NOT NULL,
      emoji       TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      UNIQUE(message_id, discord_id, emoji)
    );
    CREATE INDEX IF NOT EXISTS idx_rx_msg ON reactions(message_id);

    -- Swamp member profiles: display name, bio, and an avatar chosen from one
    -- of the member's linked DOOMPS NFTs (stored as its image URL + token id).
    CREATE TABLE IF NOT EXISTS profiles (
      discord_id     TEXT PRIMARY KEY,
      display_name   TEXT,
      bio            TEXT,
      avatar_url     TEXT,          -- image URL of the chosen NFT
      avatar_token   TEXT,          -- token id of the chosen NFT
      notify_disabled INTEGER NOT NULL DEFAULT 0,  -- 1 = chat pings muted
      updated_at     INTEGER NOT NULL
    );
  `);
  migrateColumns(db);
  seedPrizeConfig(db);
  return db;
}

/**
 * Add columns that may be missing from an older `spins` table. SQLite has no
 * "ADD COLUMN IF NOT EXISTS", so we check pragma and add as needed.
 */
function migrateColumns(db) {
  const cols = new Set(db.prepare(`PRAGMA table_info(spins)`).all().map((c) => c.name));
  const adds = [
    ["prize_label", "TEXT"],
    ["payout_address", "TEXT"],
    ["payout_status", "TEXT NOT NULL DEFAULT 'none'"],
    ["username", "TEXT"],
  ];
  for (const [name, type] of adds) {
    if (!cols.has(name)) {
      db.exec(`ALTER TABLE spins ADD COLUMN ${name} ${type}`);
    }
  }

  // profiles: added notify_disabled after initial release.
  const pcols = new Set(db.prepare(`PRAGMA table_info(profiles)`).all().map((c) => c.name));
  if (pcols.size && !pcols.has("notify_disabled")) {
    db.exec(`ALTER TABLE profiles ADD COLUMN notify_disabled INTEGER NOT NULL DEFAULT 0`);
  }

  // messages: added reply_to after initial release.
  const mcols = new Set(db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name));
  if (mcols.size && !mcols.has("reply_to")) {
    db.exec(`ALTER TABLE messages ADD COLUMN reply_to INTEGER`);
  }
}

/* ---------- prize config ---------- */
const DEFAULT_PRIZES = {
  big: "Big Prize",
  medium: "Medium Prize",
  small: "Small Prize",
  tiny: "Tiny Prize",
};

function seedPrizeConfig(db) {
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO prize_config (tier, label, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(tier) DO NOTHING`
  );
  for (const [tier, label] of Object.entries(DEFAULT_PRIZES)) {
    stmt.run(tier, label, now);
  }
}

export function getPrizeConfig(db) {
  const rows = db.prepare(`SELECT tier, label FROM prize_config`).all();
  const out = { ...DEFAULT_PRIZES };
  for (const r of rows) out[r.tier] = r.label;
  return out;
}

export function setPrizeLabel(db, { tier, label, now }) {
  if (!["big", "medium", "small", "tiny"].includes(tier)) {
    throw new Error("invalid tier");
  }
  db.prepare(
    `INSERT INTO prize_config (tier, label, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(tier) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at`
  ).run(tier, label, now);
}

/* ---------- memes ---------- */
export function addMeme(db, { discordId, username, filename, caption, now }) {
  return db.prepare(
    `INSERT INTO memes (discord_id, username, filename, caption, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(discordId, username ?? null, filename, caption ?? null, now).lastInsertRowid;
}

export function listMemes(db, { limit = 60, offset = 0 } = {}) {
  return db.prepare(
    `SELECT * FROM memes WHERE deleted = 0 ORDER BY created_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
}

export function countMemes(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM memes WHERE deleted = 0`).get().n;
}

export function getMeme(db, id) {
  return db.prepare(`SELECT * FROM memes WHERE id = ?`).get(id);
}

export function softDeleteMeme(db, id) {
  return db.prepare(`UPDATE memes SET deleted = 1 WHERE id = ?`).run(id).changes;
}

export function memeCountForUserToday(db, { discordId, dayKey }) {
  // memes are timestamped; count today's by comparing day_key derived at call site
  return db.prepare(
    `SELECT COUNT(*) AS n FROM memes WHERE discord_id = ? AND deleted = 0
     AND strftime('%Y-%m-%d', created_at/1000, 'unixepoch') = ?`
  ).get(discordId, dayKey).n;
}

export function userHasUploaded(db, { discordId }) {
  return db.prepare(
    `SELECT 1 FROM memes WHERE discord_id = ? AND deleted = 0 LIMIT 1`
  ).get(discordId) ? true : false;
}

/* ---------- spins ---------- */
export function getSpinForDay(db, { discordId, dayKey }) {
  return db.prepare(
    `SELECT * FROM spins WHERE discord_id = ? AND day_key = ?`
  ).get(discordId, dayKey);
}

/**
 * How many winners of each tier have already been awarded today.
 * Returns e.g. { big: 1, medium: 0, small: 1, tiny: 0 }.
 * Used to enforce the daily cap of one winner per tier (4 winners/day total).
 */
export function winnersByTierToday(db, { dayKey }) {
  const rows = db.prepare(
    `SELECT outcome, COUNT(*) AS n FROM spins
     WHERE day_key = ? AND outcome != 'rug' GROUP BY outcome`
  ).all(dayKey);
  const out = { big: 0, medium: 0, small: 0, tiny: 0 };
  for (const r of rows) if (r.outcome in out) out[r.outcome] = r.n;
  return out;
}

export function recordSpin(db, { discordId, dayKey, outcome, label, prizeLabel, username, now }) {
  // Returns {ok:true, id} or {ok:false, already:true} if they already spun today.
  const isWin = outcome !== "rug";
  try {
    const info = db.prepare(
      `INSERT INTO spins (discord_id, day_key, outcome, label, prize_label, username, payout_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      discordId, dayKey, outcome, label ?? null,
      isWin ? (prizeLabel ?? null) : null,
      username ?? null,
      isWin ? "pending" : "none",
      now
    );
    return { ok: true, id: info.lastInsertRowid };
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) return { ok: false, already: true };
    throw e;
  }
}

/**
 * A winner submits the wallet address they want the prize sent to.
 * Only the owner of that spin (same discord_id) and only for a winning,
 * unpaid spin. Returns {ok} or {ok:false, reason}.
 */
export function setPayoutAddress(db, { discordId, dayKey, address, now }) {
  const spin = db.prepare(
    `SELECT * FROM spins WHERE discord_id = ? AND day_key = ?`
  ).get(discordId, dayKey);
  if (!spin) return { ok: false, reason: "no spin found" };
  if (spin.outcome === "rug") return { ok: false, reason: "rugged spins have no prize" };
  if (spin.payout_status === "paid") return { ok: false, reason: "already paid" };
  db.prepare(
    `UPDATE spins SET payout_address = ?, payout_status = 'pending' WHERE id = ?`
  ).run(address, spin.id);
  return { ok: true, id: spin.id, prizeLabel: spin.prize_label };
}

/** Admin: list winning spins, newest first, optionally only unpaid. */
export function listWins(db, { onlyPending = false, limit = 200 } = {}) {
  const where = onlyPending
    ? `outcome != 'rug' AND payout_status = 'pending'`
    : `outcome != 'rug'`;
  return db.prepare(
    `SELECT * FROM spins WHERE ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

/** Admin: mark a win as paid. */
export function markPaid(db, { id }) {
  return db.prepare(
    `UPDATE spins SET payout_status = 'paid' WHERE id = ? AND outcome != 'rug'`
  ).run(id).changes;
}

export function spinHistory(db, { discordId, limit = 30 }) {
  return db.prepare(
    `SELECT * FROM spins WHERE discord_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(discordId, limit);
}

/* ---------- challenges ---------- */
export function createChallenge(db, { address, nonce, discordId, guildId, createdAt, expiresAt }) {
  return db.prepare(`
    INSERT INTO challenges (address, nonce, discord_id, guild_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(address, nonce, discordId ?? null, guildId ?? null, createdAt, expiresAt).lastInsertRowid;
}

export function findActiveChallenge(db, { address, nonce, now }) {
  return db.prepare(`
    SELECT * FROM challenges
    WHERE address = ? AND nonce = ? AND consumed = 0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(address, nonce, now);
}

export function findLatestChallengeByDiscord(db, { discordId, guildId, now }) {
  return db.prepare(`
    SELECT * FROM challenges
    WHERE discord_id = ? AND guild_id = ? AND consumed = 0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(discordId, guildId, now);
}

export function consumeChallenge(db, id) {
  db.prepare(`UPDATE challenges SET consumed = 1 WHERE id = ?`).run(id);
}

/* ---------- wallets ---------- */
export function linkWallet(db, { discordId, guildId, address, now }) {
  // If the address is already linked to someone in this guild, that row wins
  // unless it's the same user (idempotent).
  const existing = db.prepare(
    `SELECT * FROM wallets WHERE guild_id = ? AND address = ?`
  ).get(guildId, address);
  if (existing) {
    if (existing.discord_id === discordId) return { ok: true, already: true };
    return { ok: false, conflict: true, ownedBy: existing.discord_id };
  }
  db.prepare(`
    INSERT INTO wallets (discord_id, guild_id, address, verified_at)
    VALUES (?, ?, ?, ?)
  `).run(discordId, guildId, address, now);
  return { ok: true, already: false };
}

export function walletsForUser(db, { discordId, guildId }) {
  return db.prepare(
    `SELECT * FROM wallets WHERE discord_id = ? AND guild_id = ? ORDER BY id`
  ).all(discordId, guildId);
}

export function unlinkWallet(db, { discordId, guildId, address }) {
  return db.prepare(
    `DELETE FROM wallets WHERE discord_id = ? AND guild_id = ? AND address = ?`
  ).run(discordId, guildId, address).changes;
}

export function allWalletUsers(db) {
  // distinct (discord_id, guild_id) pairs that have at least one wallet
  return db.prepare(
    `SELECT DISTINCT discord_id, guild_id FROM wallets`
  ).all();
}

/* ---------- role rules ---------- */
export function addRoleRule(db, { guildId, collection, collectionName, minCount, roleId, now }) {
  return db.prepare(`
    INSERT INTO role_rules (guild_id, collection, collection_name, min_count, role_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(guildId, collection, collectionName ?? null, minCount, roleId, now).lastInsertRowid;
}

export function listRoleRules(db, { guildId }) {
  return db.prepare(
    `SELECT * FROM role_rules WHERE guild_id = ? ORDER BY collection, min_count`
  ).all(guildId);
}

export function deleteRoleRule(db, { guildId, id }) {
  return db.prepare(
    `DELETE FROM role_rules WHERE guild_id = ? AND id = ?`
  ).run(guildId, id).changes;
}

/** Distinct collection contracts referenced by a guild's rules. */
export function distinctCollections(db, { guildId }) {
  return db.prepare(
    `SELECT DISTINCT collection FROM role_rules WHERE guild_id = ?`
  ).all(guildId).map((r) => r.collection);
}

/* ---------- role grants (reconciliation bookkeeping) ---------- */
export function recordGrant(db, { discordId, guildId, roleId, now }) {
  db.prepare(`
    INSERT INTO role_grants (discord_id, guild_id, role_id, granted_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id, guild_id, role_id) DO NOTHING
  `).run(discordId, guildId, roleId, now);
}

export function removeGrant(db, { discordId, guildId, roleId }) {
  db.prepare(
    `DELETE FROM role_grants WHERE discord_id = ? AND guild_id = ? AND role_id = ?`
  ).run(discordId, guildId, roleId);
}

export function grantsForUser(db, { discordId, guildId }) {
  return db.prepare(
    `SELECT role_id FROM role_grants WHERE discord_id = ? AND guild_id = ?`
  ).all(discordId, guildId).map((r) => r.role_id);
}

/* ===================== The Swamp chat ===================== */

/* ---- channels ---- */
export function createChannel(db, { guildId, category, name, topic, readRoles, postRoles, position, now }) {
  return db.prepare(`
    INSERT INTO channels (guild_id, category, name, topic, read_roles, post_roles, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    guildId, category || "general", name, topic ?? null,
    JSON.stringify(readRoles || []), JSON.stringify(postRoles || []),
    position ?? 0, now
  ).lastInsertRowid;
}

export function listChannels(db, { guildId }) {
  return db.prepare(
    `SELECT * FROM channels WHERE guild_id = ? ORDER BY category, position, id`
  ).all(guildId).map(parseChannel);
}

export function getChannel(db, id) {
  const row = db.prepare(`SELECT * FROM channels WHERE id = ?`).get(id);
  return row ? parseChannel(row) : null;
}

export function updateChannel(db, { id, topic, readRoles, postRoles, position }) {
  const c = db.prepare(`SELECT * FROM channels WHERE id = ?`).get(id);
  if (!c) return 0;
  return db.prepare(`
    UPDATE channels SET topic = ?, read_roles = ?, post_roles = ?, position = ? WHERE id = ?
  `).run(
    topic ?? c.topic,
    JSON.stringify(readRoles ?? JSON.parse(c.read_roles)),
    JSON.stringify(postRoles ?? JSON.parse(c.post_roles)),
    position ?? c.position,
    id
  ).changes;
}

export function deleteChannel(db, { id }) {
  db.prepare(`DELETE FROM messages WHERE channel_id = ?`).run(id);
  return db.prepare(`DELETE FROM channels WHERE id = ?`).run(id).changes;
}

function parseChannel(row) {
  return {
    ...row,
    read_roles: safeJSON(row.read_roles),
    post_roles: safeJSON(row.post_roles),
  };
}
function safeJSON(s) { try { return JSON.parse(s); } catch { return []; } }

/* ---- messages ---- */
export function addMessage(db, { channelId, discordId, username, body, image, replyTo, now }) {
  return db.prepare(`
    INSERT INTO messages (channel_id, discord_id, username, body, image, reply_to, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(channelId, discordId, username ?? null, body ?? null, image ?? null, replyTo ?? null, now).lastInsertRowid;
}

/**
 * Fetch messages for a channel. `afterId` returns only newer messages (for
 * polling); otherwise returns the latest `limit` in chronological order.
 */
export function listMessages(db, { channelId, afterId = 0, limit = 50 }) {
  let rows;
  if (afterId > 0) {
    rows = db.prepare(
      `SELECT * FROM messages WHERE channel_id = ? AND id > ? AND deleted = 0 ORDER BY id ASC LIMIT ?`
    ).all(channelId, afterId, limit);
  } else {
    rows = db.prepare(
      `SELECT * FROM messages WHERE channel_id = ? AND deleted = 0 ORDER BY id DESC LIMIT ?`
    ).all(channelId, limit).reverse();
  }
  return rows;
}

export function getMessage(db, id) {
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
}

export function softDeleteMessage(db, id) {
  return db.prepare(`UPDATE messages SET deleted = 1 WHERE id = ?`).run(id).changes;
}

/* ---- reactions ---- */
export function toggleReaction(db, { messageId, discordId, emoji, now }) {
  const existing = db.prepare(
    `SELECT id FROM reactions WHERE message_id = ? AND discord_id = ? AND emoji = ?`
  ).get(messageId, discordId, emoji);
  if (existing) {
    db.prepare(`DELETE FROM reactions WHERE id = ?`).run(existing.id);
    return { on: false };
  }
  db.prepare(
    `INSERT INTO reactions (message_id, discord_id, emoji, created_at) VALUES (?, ?, ?, ?)`
  ).run(messageId, discordId, emoji, now);
  return { on: true };
}

/** Aggregate reactions for a set of message ids -> { messageId: {emoji: count} }. */
export function reactionsFor(db, messageIds) {
  if (!messageIds.length) return {};
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT message_id, emoji, COUNT(*) AS n FROM reactions
     WHERE message_id IN (${placeholders}) GROUP BY message_id, emoji`
  ).all(...messageIds);
  const out = {};
  for (const r of rows) {
    (out[r.message_id] ??= {})[r.emoji] = r.n;
  }
  return out;
}

/** Which emojis a specific user has reacted with, for a set of messages. */
export function userReactionsFor(db, { messageIds, discordId }) {
  if (!messageIds.length) return {};
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT message_id, emoji FROM reactions
     WHERE message_id IN (${placeholders}) AND discord_id = ?`
  ).all(...messageIds, discordId);
  const out = {};
  for (const r of rows) (out[r.message_id] ??= []).push(r.emoji);
  return out;
}

/** Seed a default set of channels if a guild has none yet. */
export function seedDefaultChannels(db, { guildId, now }) {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM channels WHERE guild_id = ?`).get(guildId).n;
  if (existing > 0) return false;
  const defaults = [
    { category: "INFO", name: "announcements", topic: "Official DOOMPS announcements", read: [], post: ["__admin__"], pos: 0 },
    { category: "INFO", name: "giveaways", topic: "Holder giveaways & drops", read: [], post: ["__admin__"], pos: 1 },
    { category: "SWAMP", name: "general", topic: "General swamp chatter", read: [], post: [], pos: 0 },
    { category: "SWAMP", name: "memes", topic: "Post your dankest", read: [], post: [], pos: 1 },
    { category: "SWAMP", name: "trading", topic: "Talk floor & trades", read: [], post: [], pos: 2 },
  ];
  for (const c of defaults) {
    createChannel(db, {
      guildId, category: c.category, name: c.name, topic: c.topic,
      readRoles: c.read, postRoles: c.post, position: c.pos, now,
    });
  }
  return true;
}

/* ===================== Swamp profiles ===================== */

/** Read a profile (or null). */
export function getProfile(db, discordId) {
  return db.prepare(`SELECT * FROM profiles WHERE discord_id = ?`).get(discordId) || null;
}

/**
 * Create or update a member's profile. Only provided fields are changed.
 * avatar_url + avatar_token are set together (the chosen NFT).
 */
export function upsertProfile(db, { discordId, displayName, bio, avatarUrl, avatarToken, notifyDisabled, now }) {
  const existing = getProfile(db, discordId);
  const next = {
    display_name: displayName !== undefined ? displayName : existing?.display_name ?? null,
    bio: bio !== undefined ? bio : existing?.bio ?? null,
    avatar_url: avatarUrl !== undefined ? avatarUrl : existing?.avatar_url ?? null,
    avatar_token: avatarToken !== undefined ? avatarToken : existing?.avatar_token ?? null,
    notify_disabled:
      notifyDisabled !== undefined ? (notifyDisabled ? 1 : 0) : existing?.notify_disabled ?? 0,
  };
  db.prepare(`
    INSERT INTO profiles (discord_id, display_name, bio, avatar_url, avatar_token, notify_disabled, updated_at)
    VALUES (@discord_id, @display_name, @bio, @avatar_url, @avatar_token, @notify_disabled, @updated_at)
    ON CONFLICT(discord_id) DO UPDATE SET
      display_name    = @display_name,
      bio             = @bio,
      avatar_url      = @avatar_url,
      avatar_token    = @avatar_token,
      notify_disabled = @notify_disabled,
      updated_at      = @updated_at
  `).run({ discord_id: discordId, ...next, updated_at: now });
  return getProfile(db, discordId);
}

/**
 * Fetch profiles for a set of discord ids at once -> { discordId: {name, avatar} }.
 * Used to decorate chat messages and gallery items with avatar + display name.
 */
export function profilesFor(db, discordIds) {
  const ids = [...new Set(discordIds)].filter(Boolean);
  if (!ids.length) return {};
  const ph = ids.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT discord_id, display_name, avatar_url FROM profiles WHERE discord_id IN (${ph})`
  ).all(...ids);
  const out = {};
  for (const r of rows) {
    out[r.discord_id] = { displayName: r.display_name, avatarUrl: r.avatar_url };
  }
  return out;
}

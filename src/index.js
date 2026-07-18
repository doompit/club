import { Client, GatewayIntentBits, Events, MessageFlags } from "discord.js";
import { openDb } from "@doompify/shared/db.js";
import {
  normalizeAddress,
  generateNonce,
  buildChallengeString,
  proveControl,
  CHALLENGE_TTL_MS,
} from "@doompify/shared";
import {
  createChallenge,
  findLatestChallengeByDiscord,
  consumeChallenge,
  linkWallet,
  walletsForUser,
  unlinkWallet,
} from "@doompify/shared/db.js";
import { config, keys, verifyOpts } from "./config.js";
import { syncMemberRoles } from "./rolesync.js";
import { startRecheckLoop } from "./recheck.js";

const db = openDb(config.dbPath);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

client.once(Events.ClientReady, (c) => {
  console.log(`${config.brandName} bot online as ${c.user.tag}`);
  startRecheckLoop({ client, db });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const h = {
    verify: handleVerify,
    confirm: handleConfirm,
    wallets: handleWallets,
    unlink: handleUnlink,
    sync: handleSync,
    status: handleStatus,
  }[interaction.commandName];
  if (!h) return;
  try {
    await h(interaction);
  } catch (e) {
    console.error(e);
    const msg = eph(`Something went wrong: ${e.message}`);
    if (interaction.deferred || interaction.replied) interaction.editReply(msg);
    else interaction.reply(msg);
  }
});

async function handleVerify(interaction) {
  let address;
  try {
    address = normalizeAddress(interaction.options.getString("address"));
  } catch {
    return interaction.reply(eph("That doesn't look like a valid 0x address."));
  }
  const nonce = generateNonce();
  const now = Date.now();
  createChallenge(db, {
    address, nonce,
    discordId: interaction.user.id,
    guildId: interaction.guildId,
    createdAt: now, expiresAt: now + CHALLENGE_TTL_MS,
  });
  const challenge = buildChallengeString(address, nonce);
  return interaction.reply(
    eph([
      `**Verifying** \`${short(address)}\``,
      `**Step 1.** Paste this exact mark into that wallet's **OpenSea profile bio** and save:`,
      "```", challenge, "```",
      `**Step 2.** Run \`/confirm\` here once it's saved.`,
      `_Add more wallets by running \`/verify\` again with another address. Holdings pool across all of them._`,
    ].join("\n"))
  );
}

async function handleConfirm(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const now = Date.now();
  const challenge = findLatestChallengeByDiscord(db, {
    discordId: interaction.user.id,
    guildId: interaction.guildId,
    now,
  });
  if (!challenge) {
    return interaction.editReply("No active verification. Run `/verify <address>` first.");
  }

  const result = await proveControl({
    address: challenge.address,
    nonce: challenge.nonce,
    keys, opts: verifyOpts,
  });
  if (!result.controlProven) {
    return interaction.editReply(`❌ ${result.reason}`);
  }

  consumeChallenge(db, challenge.id);
  const link = linkWallet(db, {
    discordId: interaction.user.id,
    guildId: interaction.guildId,
    address: challenge.address,
    now,
  });
  if (!link.ok && link.conflict) {
    return interaction.editReply(
      `❌ That wallet is already linked to another member in this server.`
    );
  }

  const guild = await client.guilds.fetch(interaction.guildId);
  const member = await guild.members.fetch(interaction.user.id);
  const sync = await syncMemberRoles(db, { member, guildId: interaction.guildId });

  const roleLine = sync.added.length
    ? `Granted ${sync.added.length} role(s).`
    : "No new roles from current holdings.";
  return interaction.editReply(
    `✅ Wallet \`${short(challenge.address)}\` linked. ${roleLine}`
  );
}

async function handleWallets(interaction) {
  const rows = walletsForUser(db, {
    discordId: interaction.user.id,
    guildId: interaction.guildId,
  });
  if (!rows.length) {
    return interaction.reply(eph("You have no linked wallets. Run `/verify <address>`."));
  }
  const list = rows.map((w) => `• \`${w.address}\``).join("\n");
  return interaction.reply(eph(`**Your linked wallets (${rows.length}):**\n${list}`));
}

async function handleUnlink(interaction) {
  let address;
  try {
    address = normalizeAddress(interaction.options.getString("address"));
  } catch {
    return interaction.reply(eph("Invalid address."));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const changes = unlinkWallet(db, {
    discordId: interaction.user.id,
    guildId: interaction.guildId,
    address,
  });
  if (!changes) return interaction.editReply("That wallet isn't linked to you.");

  const guild = await client.guilds.fetch(interaction.guildId);
  const member = await guild.members.fetch(interaction.user.id);
  const sync = await syncMemberRoles(db, { member, guildId: interaction.guildId });
  return interaction.editReply(
    `Unlinked \`${short(address)}\`. ${sync.removed.length ? `Revoked ${sync.removed.length} role(s).` : ""}`.trim()
  );
}

async function handleSync(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await client.guilds.fetch(interaction.guildId);
  const member = await guild.members.fetch(interaction.user.id);
  const sync = await syncMemberRoles(db, { member, guildId: interaction.guildId });
  return interaction.editReply(
    `Re-synced. Wallets: ${sync.walletCount}. +${sync.added.length} / -${sync.removed.length} roles.`
  );
}

async function handleStatus(interaction) {
  const rows = walletsForUser(db, {
    discordId: interaction.user.id,
    guildId: interaction.guildId,
  });
  if (!rows.length) {
    return interaction.reply(eph("Not verified yet. Run `/verify <address>`."));
  }
  return interaction.reply(
    eph(`You have **${rows.length}** linked wallet(s). Use \`/sync\` to refresh roles.`)
  );
}

client.login(config.botToken);

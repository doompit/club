import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { config } from "./config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verify an Ethereum wallet (repeat to add more wallets)")
    .addStringOption((o) => o.setName("address").setDescription("Your 0x address").setRequired(true)),
  new SlashCommandBuilder()
    .setName("confirm")
    .setDescription("Confirm after pasting the mark into your OpenSea bio"),
  new SlashCommandBuilder()
    .setName("wallets")
    .setDescription("List your linked wallets"),
  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlink a wallet from your account")
    .addStringOption((o) => o.setName("address").setDescription("Wallet to unlink").setRequired(true)),
  new SlashCommandBuilder()
    .setName("sync")
    .setDescription("Re-check your holdings and refresh your roles"),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show your verification status"),
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Post the DOOMPS verification panel in this channel (admins only)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.botToken);
await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
console.log(`Registered ${commands.length} guild commands to ${config.guildId}`);

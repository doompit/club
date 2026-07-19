import { config } from "../config.js";

const API = "https://discord.com/api/v10";

/** Exchange an OAuth code for a token, then fetch the user's id + username. */
export async function exchangeCodeForUser(code, redirectUri) {
  const body = new URLSearchParams({
    client_id: config.discord.clientId,
    client_secret: config.discord.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) {
    throw new Error(`OAuth token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const token = await tokenRes.json();

  const userRes = await fetch(`${API}/users/@me`, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) throw new Error(`Fetch @me failed: ${userRes.status}`);
  const user = await userRes.json();
  return { id: user.id, username: user.username };
}

/** Add a role using the BOT token. 204 = ok, 404 = member not in guild. */
export async function addRole(discordId, roleId) {
  const { guildId, botToken } = config.discord;
  const res = await fetch(
    `${API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: "PUT", headers: { Authorization: `Bot ${botToken}` } }
  );
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`addRole failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204;
}

/** Remove a role using the BOT token. */
export async function removeRole(discordId, roleId) {
  const { guildId, botToken } = config.discord;
  const res = await fetch(
    `${API}/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
    { method: "DELETE", headers: { Authorization: `Bot ${botToken}` } }
  );
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`removeRole failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204;
}

/** List the guild's roles (id + name) so the admin UI can pick from them. */
export async function listGuildRoles() {
  const { guildId, botToken } = config.discord;
  const res = await fetch(`${API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
  });
  if (!res.ok) throw new Error(`listGuildRoles failed: ${res.status}`);
  const roles = await res.json();
  return roles
    .filter((r) => r.name !== "@everyone")
    .map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

export function buildOAuthUrl(state, redirectUri, scope = "identify") {
  const params = new URLSearchParams({
    client_id: config.discord.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

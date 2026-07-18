import { normalizeAddress } from "./challenge.js";

const OPENSEA_BASE = "https://api.opensea.io/api/v2";

/**
 * Fetch an OpenSea account and return its bio text.
 * Uses the OpenSea v2 "Get Account" endpoint:
 *   GET /api/v2/accounts/{address}
 * Returns { bio, username, address } or throws.
 *
 * NOTE: OpenSea requires an API key (X-API-KEY header). The `bio` field is what
 * the user edits on their OpenSea profile page.
 */
export async function fetchOpenSeaBio(address, apiKey, { fetchImpl = fetch } = {}) {
  const addr = normalizeAddress(address);
  const url = `${OPENSEA_BASE}/accounts/${addr}`;

  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-KEY": apiKey,
    },
  });

  if (res.status === 404) {
    // Account has never been touched on OpenSea -> no profile / no bio.
    return { address: addr, bio: "", username: null, exists: false };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenSea account fetch failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return {
    address: addr,
    bio: data.bio ?? "",
    username: data.username ?? null,
    exists: true,
  };
}

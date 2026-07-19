import { normalizeAddress } from "./challenge.js";

/**
 * fetch wrapper that retries transient failures (429 rate limits, 5xx, network
 * errors) with backoff. Alchemy occasionally rate-limits or blips; this keeps
 * verification and holder checks from failing on a single hiccup.
 */
export async function fetchWithRetry(fetchImpl, url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    let res;
    try {
      res = await fetchImpl(url, opts);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`Alchemy temporarily unavailable (${res.status})`);
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      continue;
    }
    return res;
  }
  throw lastErr || new Error("Alchemy request failed");
}

/**
 * Check whether `address` owns at least one NFT from `contractAddress`
 * using Alchemy's NFT API (isHolderOfContract is cheapest/most direct):
 *   GET /nft/v3/{apiKey}/isHolderOfContract?wallet=...&contractAddress=...
 *
 * Returns { isHolder: boolean }.
 */
export async function isHolderOfCollection(
  address,
  contractAddress,
  apiKey,
  { network = "eth-mainnet", fetchImpl = fetch } = {}
) {
  const wallet = normalizeAddress(address);
  const contract = normalizeAddress(contractAddress);

  const base = `https://${network}.g.alchemy.com/nft/v3/${apiKey}`;
  const url = `${base}/isHolderOfContract?wallet=${wallet}&contractAddress=${contract}`;

  const res = await fetchWithRetry(fetchImpl, url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alchemy holder check failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  // Endpoint returns { isHolderOfContract: bool }. Read defensively in case the
  // field name varies across API versions.
  const held =
    data.isHolderOfContract ??
    data.isHolderOfCollection ??
    data.isHolder ??
    false;
  return { isHolder: Boolean(held) };
}

/**
 * Optional: return the count / token IDs held from a collection, for tiered
 * roles (e.g. 1 NFT = holder role, 5+ = whale role). Uses getNFTsForOwner
 * filtered by contract.
 */
export async function getHeldTokenIds(
  address,
  contractAddress,
  apiKey,
  { network = "eth-mainnet", fetchImpl = fetch, pageKey } = {}
) {
  const wallet = normalizeAddress(address);
  const contract = normalizeAddress(contractAddress);
  const base = `https://${network}.g.alchemy.com/nft/v3/${apiKey}`;
  let url =
    `${base}/getNFTsForOwner?owner=${wallet}` +
    `&contractAddresses[]=${contract}&withMetadata=false`;
  if (pageKey) url += `&pageKey=${encodeURIComponent(pageKey)}`;

  const res = await fetchWithRetry(fetchImpl, url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alchemy getNFTsForOwner failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  const ids = (data.ownedNfts ?? []).map((n) => n.tokenId);
  return { tokenIds: ids, count: ids.length, pageKey: data.pageKey ?? null };
}

/**
 * Fetch a wallet's held NFTs for a collection WITH metadata (image URLs),
 * for building an avatar picker. Returns up to `limit` items:
 *   [{ tokenId, name, image }]
 * image is normalized to a usable https/ipfs URL when available.
 */
export async function getHeldNftsWithImages(
  address,
  contractAddress,
  apiKey,
  { network = "eth-mainnet", fetchImpl = fetch, limit = 50 } = {}
) {
  const wallet = normalizeAddress(address);
  const contract = normalizeAddress(contractAddress);
  const base = `https://${network}.g.alchemy.com/nft/v3/${apiKey}`;
  const url =
    `${base}/getNFTsForOwner?owner=${wallet}` +
    `&contractAddresses[]=${contract}&withMetadata=true&pageSize=${Math.min(limit, 100)}`;

  const res = await fetchWithRetry(fetchImpl, url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alchemy getNFTsForOwner(meta) failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  const out = [];
  for (const n of data.ownedNfts ?? []) {
    const tokenId = n.tokenId;
    const name = n.name || n.raw?.metadata?.name || `#${tokenId}`;
    // Alchemy v3 exposes cached/normalized images under `image`
    let image =
      n.image?.cachedUrl ||
      n.image?.thumbnailUrl ||
      n.image?.originalUrl ||
      n.raw?.metadata?.image ||
      null;
    image = normalizeImageUrl(image);
    out.push({ tokenId, name, image });
    if (out.length >= limit) break;
  }
  return out;
}

/** Turn ipfs:// URLs into a public gateway URL; pass through http(s). */
export function normalizeImageUrl(url) {
  if (!url) return null;
  if (url.startsWith("ipfs://")) {
    return "https://ipfs.io/ipfs/" + url.slice("ipfs://".length).replace(/^ipfs\//, "");
  }
  return url;
}

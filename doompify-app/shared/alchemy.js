import { normalizeAddress } from "./challenge.js";

/**
 * Check whether `address` owns at least one NFT from `contractAddress`
 * using Alchemy's NFT API (isHolderOfCollection is cheapest/most direct):
 *   GET /nft/v3/{apiKey}/isHolderOfCollection?wallet=...&contractAddress=...
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
  const url = `${base}/isHolderOfCollection?wallet=${wallet}&contractAddress=${contract}`;

  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alchemy holder check failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return { isHolder: Boolean(data.isHolderOfCollection) };
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

  const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Alchemy getNFTsForOwner failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  const ids = (data.ownedNfts ?? []).map((n) => n.tokenId);
  return { tokenIds: ids, count: ids.length, pageKey: data.pageKey ?? null };
}

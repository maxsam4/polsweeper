import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

const SEQUENCE_ENDPOINT =
  "https://polygon-indexer.sequence.app/rpc/Indexer/GetTokenBalancesSummary";

// Load token whitelist at startup
let contractWhitelist: string[] = [];
const tokenMeta = new Map<string, { symbol: string; name: string; decimals: number }>();

try {
  const whitelistPath = path.join(__dirname, "../../data/token-whitelist.json");
  const raw = JSON.parse(fs.readFileSync(whitelistPath, "utf-8"));
  if (Array.isArray(raw.tokens)) {
    for (const t of raw.tokens) {
      contractWhitelist.push(t.address);
      tokenMeta.set(t.address.toLowerCase(), {
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
      });
    }
    console.log(`Loaded token whitelist: ${contractWhitelist.length} tokens`);
  }
} catch (err: any) {
  console.warn(`Token whitelist not loaded (${err.message}), running without filtering`);
}

const MAX_BACKOFF_MS = 30_000;
const INITIAL_BACKOFF_MS = 2_000;

export interface TokenBalance {
  contractAddress: string;
  accountAddress: string;
  balance: string;
  contractType?: string;
  blockHash?: string;
  blockNumber?: number;
  chainId?: number;
  uniqueCollectibles?: string;
}

interface NativeBalance {
  accountAddress: string;
  chainId: number;
  balance: string;
  name?: string;
  symbol?: string;
}

export interface BalancesResponse {
  balances: TokenBalance[];
  nativeBalances?: NativeBalance[];
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 5
): Promise<Response> {
  let backoff = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      // If server error (5xx) or rate limit (429), retry
      if (response.status >= 500 || response.status === 429) {
        if (attempt < retries) {
          console.warn(
            `Sequence indexer returned ${response.status}, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`
          );
          await new Promise((r) => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          continue;
        }
      }

      throw new Error(
        `Sequence indexer error: ${response.status} ${response.statusText}`
      );
    } catch (error) {
      if (attempt < retries && error instanceof TypeError) {
        // Network error — retry
        console.warn(
          `Sequence indexer network error, retrying in ${backoff}ms (attempt ${attempt + 1}/${retries})`
        );
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }
      throw error;
    }
  }

  throw new Error("Sequence indexer: max retries exceeded");
}

export async function getBalances(
  addresses: string[]
): Promise<TokenBalance[]> {
  if (addresses.length === 0) return [];

  const body = {
    chainID: "polygon",
    omitMetadata: true,
    filter: {
      contractStatus: "ALL",
      accountAddresses: addresses,
      ...(contractWhitelist.length > 0 && { contractWhitelist }),
    },
  };

  const response = await fetchWithRetry(SEQUENCE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Access-Key": config.sequenceApiKey,
    },
    body: JSON.stringify(body),
  });

  const data = (await response.json()) as BalancesResponse;
  const results: TokenBalance[] = data.balances || [];

  // Native POL balances come in a separate array — normalize them
  if (data.nativeBalances) {
    for (const nb of data.nativeBalances) {
      if (BigInt(nb.balance) > 0n) {
        results.push({
          contractAddress: "0x0000000000000000000000000000000000000000",
          accountAddress: nb.accountAddress,
          balance: nb.balance,
        });
      }
    }
  }

  return results;
}

/**
 * Returns a human-readable symbol for a token address, or the address itself.
 */
export function getTokenSymbol(address: string): string {
  const meta = tokenMeta.get(address.toLowerCase());
  return meta?.symbol ?? address;
}

/**
 * Returns the number of tokens in the whitelist.
 */
export function getWhitelistCount(): number {
  return contractWhitelist.length;
}

/**
 * Returns token info (symbol + decimals) for a given address, or null if unknown.
 */
export function getTokenInfo(address: string): { symbol: string; decimals: number } | null {
  const meta = tokenMeta.get(address.toLowerCase());
  if (!meta) return null;
  return { symbol: meta.symbol, decimals: meta.decimals };
}

/**
 * Groups balances by account address for easier consumption.
 */
export function groupBalancesByAddress(
  balances: TokenBalance[]
): Map<string, TokenBalance[]> {
  const grouped = new Map<string, TokenBalance[]>();
  for (const balance of balances) {
    const addr = balance.accountAddress.toLowerCase();
    const existing = grouped.get(addr) || [];
    existing.push(balance);
    grouped.set(addr, existing);
  }
  return grouped;
}

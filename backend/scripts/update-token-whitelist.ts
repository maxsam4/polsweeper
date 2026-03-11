import * as fs from "fs";
import * as path from "path";

const SOURCES = [
  {
    name: "CoinGecko",
    url: "https://tokens.coingecko.com/polygon-pos/all.json",
  },
  {
    name: "Uniswap",
    url: "https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/polygon.json",
  },
  {
    name: "Sushi",
    url: "https://raw.githubusercontent.com/sushiswap/list/master/lists/token-lists/default-token-list/tokens/polygon.json",
  },
];

const FETCH_TIMEOUT_MS = 15_000;

// Mandatory fallback tokens (Polygon mainnet)
const FALLBACK_TOKENS: TokenEntry[] = [
  { address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", symbol: "WMATIC", name: "Wrapped Matic", decimals: 18 },
  { address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", symbol: "USDC", name: "USD Coin", decimals: 6 },
  { address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", symbol: "USDT", name: "Tether USD", decimals: 6 },
  { address: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063", symbol: "DAI", name: "Dai Stablecoin", decimals: 18 },
  { address: "0x2791bca1f2de4661ed88a30c99a7a9449aa84174", symbol: "USDC.e", name: "Bridged USDC", decimals: 6 },
  { address: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", symbol: "WETH", name: "Wrapped Ether", decimals: 18 },
  { address: "0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", symbol: "WBTC", name: "Wrapped BTC", decimals: 8 },
  { address: "0xd6df932a45c0f255f85145f286ea0b292b21c90b", symbol: "AAVE", name: "Aave Token", decimals: 18 },
  { address: "0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39", symbol: "LINK", name: "ChainLink Token", decimals: 18 },
];

interface TokenEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

interface RawToken {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  chainId?: number;
}

async function fetchSource(source: { name: string; url: string }): Promise<RawToken[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    console.log(`Fetching ${source.name}...`);
    const res = await fetch(source.url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = await res.json();

    // Handle both { tokens: [...] } wrapper and raw array formats
    const tokens: RawToken[] = Array.isArray(data) ? data : data.tokens;
    if (!Array.isArray(tokens)) {
      throw new Error("Unexpected response format");
    }

    console.log(`  ${source.name}: ${tokens.length} tokens`);
    return tokens;
  } catch (err: any) {
    console.warn(`  ${source.name} failed: ${err.message}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  // Fetch all sources in parallel
  const results = await Promise.all(SOURCES.map(fetchSource));
  const allRaw = results.flat();

  // Filter to chainId 137 only, normalize addresses
  const byAddress = new Map<string, TokenEntry>();

  for (const raw of allRaw) {
    if (!raw.address || !raw.symbol) continue;
    if (raw.chainId !== undefined && raw.chainId !== 137) continue;

    const addr = raw.address.toLowerCase();
    const entry: TokenEntry = {
      address: addr,
      symbol: raw.symbol,
      name: raw.name || raw.symbol,
      decimals: raw.decimals ?? 18,
    };

    // Prefer entry with most metadata (longer name)
    const existing = byAddress.get(addr);
    if (!existing || (entry.name.length > existing.name.length)) {
      byAddress.set(addr, entry);
    }
  }

  // Inject mandatory fallback tokens if missing
  for (const fallback of FALLBACK_TOKENS) {
    if (!byAddress.has(fallback.address)) {
      byAddress.set(fallback.address, fallback);
    }
  }

  // Sort by symbol for stable VCS diffs
  const tokens = Array.from(byAddress.values()).sort((a, b) =>
    a.symbol.toLowerCase().localeCompare(b.symbol.toLowerCase())
  );

  const output = {
    updatedAt: new Date().toISOString(),
    chainId: 137,
    tokens,
  };

  const outPath = path.join(__dirname, "../data/token-whitelist.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`\nWrote ${tokens.length} tokens to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import { type Address } from "viem";
import { getBalances, type TokenBalance } from "./indexer";
import { sendDeployAndSweep, sendSweepAll } from "./chain";
import { markDeployed } from "../db/queries";

export interface SweepResult {
  swept: boolean;
  txHash?: string;
  tokens: string[];
}

/**
 * Sweep a single virtual account:
 * 1. Query indexer for balances
 * 2. If balances found, submit sweep tx (deploy first if needed)
 * 3. Update DB after receipt
 */
export async function sweepAccount(
  address: string,
  master: string,
  accountIndex: number,
  deployed: number
): Promise<SweepResult> {
  // Query indexer for balances at this address
  const balances = await getBalances([address]);

  if (!balances || balances.length === 0) {
    return { swept: false, tokens: [] };
  }

  // Extract unique token contract addresses (non-native).
  // Native POL has contractAddress as the zero address or empty string in Sequence.
  const seen = new Set<string>();
  const tokenAddresses: Address[] = [];
  const allTokenLabels: string[] = [];

  for (const b of balances) {
    const bal = BigInt(b.balance);
    if (bal <= 0n) continue;

    const contractAddr = b.contractAddress.toLowerCase();
    // Native POL: zero address or empty
    if (
      contractAddr === "0x0000000000000000000000000000000000000000" ||
      contractAddr === ""
    ) {
      if (!seen.has("native")) {
        seen.add("native");
        allTokenLabels.push("POL (native)");
      }
    } else if (!seen.has(contractAddr)) {
      seen.add(contractAddr);
      tokenAddresses.push(contractAddr as Address);
      allTokenLabels.push(contractAddr);
    }
  }

  if (allTokenLabels.length === 0) {
    return { swept: false, tokens: [] };
  }

  console.log(
    `Sweeping ${address} (index ${accountIndex}): ${allTokenLabels.length} token(s) — ${allTokenLabels.join(", ")}`
  );

  let txHash: string;

  if (!deployed) {
    // Clone not yet deployed — use factory.deployAndSweep
    txHash = await sendDeployAndSweep(
      master as Address,
      BigInt(accountIndex),
      tokenAddresses
    );
    // Mark as deployed in DB only after successful tx
    markDeployed(address);
    console.log(
      `Deployed and swept ${address} (tx: ${txHash})`
    );
  } else {
    // Clone already deployed — call sweepAll directly on clone
    txHash = await sendSweepAll(address as Address, tokenAddresses);
    console.log(`Swept ${address} (tx: ${txHash})`);
  }

  return { swept: true, txHash, tokens: allTokenLabels };
}

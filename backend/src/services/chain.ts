import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseGwei,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Address,
} from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "../config";
import factoryAbi from "../../abi/VirtualAccountCreator.json";
import implAbi from "../../abi/VirtualAccountImpl.json";

// ── Clients ─────────────────────────────────────────────────────────────

export const publicClient: PublicClient<Transport, Chain> = createPublicClient({
  chain: polygon,
  transport: http(config.rpcUrl),
});

const account = privateKeyToAccount(config.gasPrivateKey);

export const walletClient: WalletClient = createWalletClient({
  account,
  chain: polygon,
  transport: http(config.rpcUrl),
});

export const gasAccountAddress: Address = account.address;

// ── Gas Balance ──────────────────────────────────────────────────────────

let lastGasBalance: bigint | null = null;

export function getLastGasBalance(): bigint | null {
  return lastGasBalance;
}

export async function getGasBalance(): Promise<bigint> {
  const balance = await publicClient.getBalance({ address: account.address });
  lastGasBalance = balance;
  return balance;
}

export function getQueueDepth(): number {
  return queue.length;
}

// ── ABI exports ─────────────────────────────────────────────────────────

export const factoryABI = factoryAbi as readonly unknown[];
export const implABI = implAbi as readonly unknown[];

// ── Signer Queue ────────────────────────────────────────────────────────
// Ensures sequential transaction submission to avoid nonce conflicts.

type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const queue: QueuedTask<unknown>[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }

  processing = false;
}

export function queueTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject } as QueuedTask<unknown>);
    processQueue();
  });
}

// ── Contract helpers ────────────────────────────────────────────────────

export async function getVirtualAddress(
  master: Address,
  index: bigint
): Promise<Address> {
  const result = await publicClient.readContract({
    address: config.factoryAddress,
    abi: factoryABI,
    functionName: "getAddress",
    args: [master, index],
  });
  return result as Address;
}

// ── Gas Bump Logic ─────────────────────────────────────────────────────
// Sends a tx and bumps fees by 10% every 10s until confirmed, up to 1000 gwei cap.

const BUMP_INTERVAL_MS = 10_000;
const BUMP_MULTIPLIER = 110n; // 10%
const INITIAL_PRIORITY_FEE = parseGwei("31");
const MAX_FEE_WEI = parseGwei("1000");

type GasOpts = { nonce: number; maxPriorityFeePerGas: bigint; maxFeePerGas: bigint };

async function sendWithGasBump(
  writeTx: (opts: GasOpts) => Promise<`0x${string}`>
): Promise<`0x${string}`> {
  const nonce = await publicClient.getTransactionCount({
    address: gasAccountAddress,
    blockTag: "pending",
  });

  const block = await publicClient.getBlock();
  const baseFee = block.baseFeePerGas ?? parseGwei("30");

  let priorityFee = INITIAL_PRIORITY_FEE;
  let maxFee = baseFee * 2n + priorityFee;
  if (maxFee > MAX_FEE_WEI) maxFee = MAX_FEE_WEI;

  let latestHash = await writeTx({ nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee });
  let lastBumpTime = Date.now();

  while (true) {
    await new Promise((r) => setTimeout(r, 2_000));

    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: latestHash });
      if (receipt.status === "reverted") {
        throw new Error(`Transaction reverted: ${latestHash}`);
      }
      return latestHash;
    } catch (err: any) {
      if (!err.name?.includes("TransactionReceiptNotFound")) throw err;
    }

    if (Date.now() - lastBumpTime < BUMP_INTERVAL_MS) continue;
    if (maxFee >= MAX_FEE_WEI) continue;

    priorityFee = (priorityFee * BUMP_MULTIPLIER) / 100n;
    maxFee = (maxFee * BUMP_MULTIPLIER) / 100n;
    if (priorityFee > MAX_FEE_WEI) priorityFee = MAX_FEE_WEI;
    if (maxFee > MAX_FEE_WEI) maxFee = MAX_FEE_WEI;

    console.log(
      `Gas bump: maxFee=${(Number(maxFee) / 1e9).toFixed(1)} gwei, ` +
        `priorityFee=${(Number(priorityFee) / 1e9).toFixed(1)} gwei`
    );

    try {
      latestHash = await writeTx({ nonce, maxPriorityFeePerGas: priorityFee, maxFeePerGas: maxFee });
      lastBumpTime = Date.now();
    } catch {
      // Replacement failed (likely nonce used = tx mined), next poll will find receipt
    }
  }
}

export async function sendDeployAndSweep(
  master: Address,
  index: bigint,
  tokens: Address[]
): Promise<`0x${string}`> {
  return queueTransaction(() =>
    sendWithGasBump(({ nonce, maxPriorityFeePerGas, maxFeePerGas }) =>
      walletClient.writeContract({
        address: config.factoryAddress,
        abi: factoryABI,
        functionName: "deployAndSweep",
        args: [master, index, tokens],
        chain: polygon,
        account,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
      })
    )
  );
}

export async function sendSweepAll(
  cloneAddress: Address,
  tokens: Address[]
): Promise<`0x${string}`> {
  return queueTransaction(() =>
    sendWithGasBump(({ nonce, maxPriorityFeePerGas, maxFeePerGas }) =>
      walletClient.writeContract({
        address: cloneAddress,
        abi: implABI,
        functionName: "sweepAll",
        args: [tokens],
        chain: polygon,
        account,
        nonce,
        maxPriorityFeePerGas,
        maxFeePerGas,
      })
    )
  );
}

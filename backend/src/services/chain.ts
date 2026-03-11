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

export async function sendDeployAndSweep(
  master: Address,
  index: bigint,
  tokens: Address[]
): Promise<`0x${string}`> {
  return queueTransaction(async () => {
    const hash = await walletClient.writeContract({
      address: config.factoryAddress,
      abi: factoryABI,
      functionName: "deployAndSweep",
      args: [master, index, tokens],
      chain: polygon,
      account,
      maxPriorityFeePerGas: parseGwei("31"),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`deployAndSweep reverted: ${hash}`);
    }
    return hash;
  });
}

export async function sendSweepAll(
  cloneAddress: Address,
  tokens: Address[]
): Promise<`0x${string}`> {
  return queueTransaction(async () => {
    const hash = await walletClient.writeContract({
      address: cloneAddress,
      abi: implABI,
      functionName: "sweepAll",
      args: [tokens],
      chain: polygon,
      account,
      maxPriorityFeePerGas: parseGwei("31"),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(`sweepAll reverted: ${hash}`);
    }
    return hash;
  });
}

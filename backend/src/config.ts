import dotenv from "dotenv";
import { type Address, isAddress } from "viem";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireAddress(name: string): Address {
  const value = requireEnv(name);
  if (!isAddress(value)) {
    throw new Error(`Invalid address in environment variable ${name}: ${value}`);
  }
  return value as Address;
}

const port = parseInt(process.env.PORT || "3001", 10);
if (isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const gasKey = requireEnv("GAS_PRIVATE_KEY");
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(gasKey)) {
  throw new Error("GAS_PRIVATE_KEY must be a 64-character hex string (optionally prefixed with 0x)");
}

export const config = {
  gasPrivateKey: (gasKey.startsWith("0x") ? gasKey : `0x${gasKey}`) as `0x${string}`,
  sequenceApiKey: requireEnv("SEQUENCE_API_KEY"),
  rpcUrl: process.env.RPC_URL || "https://polygon-rpc.com",
  factoryAddress: requireAddress("FACTORY_ADDRESS"),
  authToken: requireEnv("AUTH_TOKEN"),
  port,
  chainId: 137,
} as const;

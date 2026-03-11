import { Account } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const AUTH_TOKEN = import.meta.env.VITE_AUTH_TOKEN || '';

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${AUTH_TOKEN}`,
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json();
}

interface AccountsResponse {
  accounts: Account[];
}

interface CreateResponse {
  accounts: Account[];
  total: number;
}

interface SweepResponse {
  swept: boolean;
  txHash?: string;
  tokens: string[];
}

export async function getAccounts(master: string): Promise<Account[]> {
  const res = await fetch(`${BASE_URL}/api/accounts/${encodeURIComponent(master)}`, {
    method: 'GET',
    headers: headers(),
  });
  const data = await handleResponse<AccountsResponse>(res);
  return data.accounts;
}

export async function createAccounts(
  master: string,
  count: number,
): Promise<Account[]> {
  const res = await fetch(`${BASE_URL}/api/create`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ master, count }),
  });
  const data = await handleResponse<CreateResponse>(res);
  return data.accounts;
}

export interface SweepEventResponse {
  id: number;
  account_address: string;
  master: string;
  tx_hash: string;
  tokens_swept: string[];
  created_at: string;
}

export interface StatsResponse {
  totalAccounts: number;
  uniqueMasters: number;
  deployedAccounts: number;
  undeployedAccounts: number;
  totalSweeps: number;
  recentSweeps: SweepEventResponse[];
}

export async function getStats(): Promise<StatsResponse> {
  const res = await fetch(`${BASE_URL}/api/stats`, {
    method: 'GET',
    headers: headers(),
  });
  return handleResponse<StatsResponse>(res);
}

export async function sweepAccount(address: string): Promise<SweepResponse> {
  const res = await fetch(`${BASE_URL}/api/sweep`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ account: address }),
  });
  return handleResponse<SweepResponse>(res);
}

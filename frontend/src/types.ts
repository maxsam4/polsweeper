export interface TokenBalance {
  contractAddress: string;
  balance: string;
  symbol?: string;
  decimals?: number;
}

export interface Account {
  address: string;
  index: number;
  master: string;
  deployed: boolean;
  createdAt: string;
  balances: TokenBalance[];
}

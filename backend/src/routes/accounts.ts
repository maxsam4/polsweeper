import { Router, type Request, type Response } from "express";
import { isAddress } from "viem";
import { getAccountsByMaster } from "../db/queries";
import {
  getBalances,
  getTokenInfo,
  groupBalancesByAddress,
  type TokenBalance,
} from "../services/indexer";

const router = Router();

router.get("/:master", async (req: Request, res: Response): Promise<void> => {
  try {
    const { master } = req.params;

    if (!master || typeof master !== "string" || !isAddress(master)) {
      res.status(400).json({ error: "Invalid master address" });
      return;
    }

    // Fetch accounts from SQLite
    const accounts = getAccountsByMaster(master);

    if (accounts.length === 0) {
      res.json({ accounts: [] });
      return;
    }

    // Fetch balances from Sequence indexer for all account addresses
    const addresses = accounts.map((a) => a.address);
    let balancesByAddress: Map<string, TokenBalance[]> = new Map();

    try {
      const balances = await getBalances(addresses);
      balancesByAddress = groupBalancesByAddress(balances);
    } catch (error) {
      console.error("Error fetching balances from indexer:", error);
      // Return accounts without balances rather than failing entirely
    }

    const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

    const result = accounts.map((account) => ({
      address: account.address,
      index: account.account_index,
      master: account.master,
      deployed: account.deployed === 1,
      createdAt: account.created_at,
      balances: (balancesByAddress.get(account.address.toLowerCase()) || []).map((b) => {
        const isNative = b.contractAddress.toLowerCase() === ZERO_ADDR || b.contractAddress === "";
        if (isNative) {
          return { ...b, symbol: "POL", decimals: 18 };
        }
        const info = getTokenInfo(b.contractAddress);
        return { ...b, symbol: info?.symbol, decimals: info?.decimals };
      }),
    }));

    res.json({ accounts: result });
  } catch (error) {
    console.error("Error fetching accounts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

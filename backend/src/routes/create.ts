import { Router, type Request, type Response } from "express";
import { isAddress, type Address } from "viem";
import { getAccountCount, insertAccountsBatch, atomicCreateAccounts } from "../db/queries";
import { getVirtualAddress } from "../services/chain";

const router = Router();

const MAX_ACCOUNTS_PER_MASTER = 5;

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { master, count } = req.body as { master?: string; count?: number };

    // Validate master address
    if (!master || !isAddress(master)) {
      res.status(400).json({ error: "Invalid master address" });
      return;
    }

    // Validate count
    const numCount = Number(count) || 1;
    if (numCount < 1 || numCount > 5) {
      res.status(400).json({ error: "Count must be between 1 and 5" });
      return;
    }

    // Compute addresses first (off-chain, no DB needed yet)
    // We need to know the existing count to pick starting index,
    // but the actual limit check + insert is done atomically below.
    const existingCount = getAccountCount(master);
    if (existingCount >= MAX_ACCOUNTS_PER_MASTER) {
      res.status(400).json({
        error: "Maximum account limit reached (5). Contact Polygon Labs for more.",
        existingCount,
      });
      return;
    }

    const available = MAX_ACCOUNTS_PER_MASTER - existingCount;
    if (numCount > available) {
      res.status(400).json({
        error: `Can only create ${available} more account(s). You have ${existingCount} of ${MAX_ACCOUNTS_PER_MASTER}.`,
        existingCount,
        available,
      });
      return;
    }

    // Compute deterministic addresses off-chain via factory readContract
    const startIndex = existingCount;
    const accountsToInsert: {
      master: string;
      address: string;
      accountIndex: number;
    }[] = [];

    for (let i = 0; i < numCount; i++) {
      const index = startIndex + i;
      const predictedAddress = await getVirtualAddress(
        master as Address,
        BigInt(index)
      );
      accountsToInsert.push({
        master,
        address: predictedAddress,
        accountIndex: index,
      });
    }

    // Atomic check + insert to prevent TOCTOU race
    const accounts = atomicCreateAccounts(master, accountsToInsert, MAX_ACCOUNTS_PER_MASTER);
    if (!accounts) {
      res.status(400).json({
        error: "Maximum account limit reached (5). Contact Polygon Labs for more.",
      });
      return;
    }

    res.status(201).json({
      accounts: accounts.map((a) => ({
        address: a.address,
        index: a.account_index,
        master: a.master,
        deployed: false,
        createdAt: a.created_at,
      })),
      total: existingCount + numCount,
    });
  } catch (error) {
    console.error("Error creating accounts:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

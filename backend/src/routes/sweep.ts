import { Router, type Request, type Response } from "express";
import { isAddress } from "viem";
import { getAccountByAddress } from "../db/queries";
import { sweepAccount } from "../services/sweep";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { account } = req.body as { account?: string };

    if (!account || !isAddress(account)) {
      res.status(400).json({ error: "Invalid account address" });
      return;
    }

    // Validate account exists in DB
    const dbAccount = getAccountByAddress(account);
    if (!dbAccount) {
      res.status(404).json({ error: "Account not found" });
      return;
    }

    const result = await sweepAccount(
      dbAccount.address,
      dbAccount.master,
      dbAccount.account_index,
      dbAccount.deployed
    );

    if (result.skipped) {
      res.status(409).json({ error: result.skipped });
      return;
    }

    if (!result.swept) {
      res.json({ message: "No balances to sweep", swept: false });
      return;
    }

    res.json({
      message: "Sweep successful",
      swept: true,
      txHash: result.txHash,
      tokens: result.tokens,
    });
  } catch (error) {
    console.error("Error sweeping account:", error);
    res.status(500).json({ error: "Sweep failed" });
  }
});

export default router;

import { Router, type Request, type Response } from "express";
import { getStats } from "../db/queries";

const router = Router();

router.get("/", (_req: Request, res: Response): void => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

export default router;

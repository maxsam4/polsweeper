import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { timingSafeEqual } from "crypto";
import { formatEther, parseEther } from "viem";
import { config } from "./config";
import { closeDb } from "./db/schema";
import { getAllAccounts } from "./db/queries";
import { sweepAccount } from "./services/sweep";
import { getGasBalance, getLastGasBalance, getQueueDepth } from "./services/chain";
import { getWhitelistCount } from "./services/indexer";
import createRouter from "./routes/create";
import accountsRouter from "./routes/accounts";
import sweepRouter from "./routes/sweep";
import statsRouter from "./routes/stats";

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Constant-time string comparison to prevent timing attacks
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Pad to same length to avoid leaking token length via early return
  const maxLen = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(maxLen);
  const padB = Buffer.alloc(maxLen);
  bufA.copy(padA);
  bufB.copy(padB);
  return bufA.length === bufB.length && timingSafeEqual(padA, padB);
}

// Basic auth middleware
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    if (safeCompare(token, config.authToken)) {
      next();
      return;
    }
  }

  // Check query param
  const queryToken = req.query.token as string | undefined;
  if (queryToken && safeCompare(queryToken, config.authToken)) {
    next();
    return;
  }

  res.status(401).json({ error: "Unauthorized" });
}

// Apply auth to all /api routes
app.use("/api", authMiddleware);

// ── Routes ──────────────────────────────────────────────────────────────

app.use("/api/create", createRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/sweep", sweepRouter);
app.use("/api/stats", statsRouter);

// Health check (no auth)
const startedAt = Date.now();
let sweeperLastCycleAt: string | null = null;
let sweeperAccountsInLastCycle = 0;

app.get("/health", async (_req: Request, res: Response) => {
  const gasBalance = getLastGasBalance();
  res.json({
    status: "ok",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    sweeper: {
      running: sweeperRunning,
      lastCycleAt: sweeperLastCycleAt,
      accountsInLastCycle: sweeperAccountsInLastCycle,
    },
    gasBalance: gasBalance !== null ? formatEther(gasBalance) : null,
    queueDepth: getQueueDepth(),
    whitelistCount: getWhitelistCount(),
  });
});

// ── Sweeper Loop ────────────────────────────────────────────────────────

let sweeperRunning = false;

async function runSweeper(): Promise<void> {
  sweeperRunning = true;
  console.log("Sweeper service started");

  while (sweeperRunning) {
    try {
      // Check gas balance before each cycle
      const gasBalance = await getGasBalance();
      const gasBalanceFormatted = formatEther(gasBalance);
      console.log(`Sweeper cycle: gas balance = ${gasBalanceFormatted} POL`);

      if (gasBalance < parseEther("0.5")) {
        console.error(`CRITICAL: Gas balance too low (${gasBalanceFormatted} POL), skipping cycle`);
        await new Promise((r) => setTimeout(r, 30000));
        continue;
      }
      if (gasBalance < parseEther("5")) {
        console.warn(`WARNING: Gas balance low (${gasBalanceFormatted} POL)`);
      }

      const accounts = getAllAccounts();

      for (const account of accounts) {
        if (!sweeperRunning) break;

        try {
          await sweepAccount(
            account.address,
            account.master,
            account.account_index,
            account.deployed
          );
        } catch (error) {
          console.error(`Sweep failed for ${account.address}:`, error);
        }

        // 2 second delay between accounts
        await new Promise((r) => setTimeout(r, 2000));
      }

      sweeperLastCycleAt = new Date().toISOString();
      sweeperAccountsInLastCycle = accounts.length;

      // Sleep between sweep cycles to avoid hammering the indexer
      if (accounts.length === 0) {
        await new Promise((r) => setTimeout(r, 10000));
      } else {
        await new Promise((r) => setTimeout(r, 30000));
      }
    } catch (error) {
      console.error("Sweeper loop error:", error);
      // Wait before retrying the whole loop
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  console.log("Sweeper service stopped");
}

// ── Server Startup ──────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  console.log(`Polsweeper backend listening on port ${config.port}`);
  console.log(`Auth required: Bearer token or ?token= query param`);

  // Start sweeper in background
  runSweeper().catch((error) => {
    console.error("Sweeper crashed:", error);
  });
});

// ── Graceful Shutdown ───────────────────────────────────────────────────

function shutdown(signal: string): void {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  sweeperRunning = false;

  server.close(() => {
    console.log("HTTP server closed");
    closeDb();
    console.log("Database closed");
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export default app;

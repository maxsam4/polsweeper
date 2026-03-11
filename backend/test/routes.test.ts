import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mock chain module before any app imports
vi.mock("../src/services/chain", () => ({
  publicClient: {},
  walletClient: {},
  gasAccountAddress: "0x0000000000000000000000000000000000000099",
  factoryABI: [],
  implABI: [],
  getVirtualAddress: vi.fn(),
  sendDeployAndSweep: vi.fn(),
  sendSweepAll: vi.fn(),
  queueTransaction: vi.fn(),
  getGasBalance: vi.fn().mockResolvedValue(BigInt("10000000000000000000")),
  getLastGasBalance: vi.fn().mockReturnValue(BigInt("10000000000000000000")),
  getQueueDepth: vi.fn().mockReturnValue(0),
}));

// Mock indexer module
vi.mock("../src/services/indexer", () => ({
  getBalances: vi.fn().mockResolvedValue([]),
  getTokenSymbol: vi.fn((addr: string) => addr),
  groupBalancesByAddress: vi.fn().mockReturnValue(new Map()),
  getWhitelistCount: vi.fn().mockReturnValue(0),
}));

import app from "../src/index";
import { getVirtualAddress, sendDeployAndSweep } from "../src/services/chain";
import { getBalances } from "../src/services/indexer";

const AUTH = "test-auth-token";

// Counter to generate unique addresses per test
let addrCounter = 0xa000;
function uniqueAddr(): string {
  return `0x${(addrCounter++).toString(16).padStart(40, "0")}`;
}

describe("Auth middleware", () => {
  it("rejects requests without auth", async () => {
    const res = await request(app).get("/api/stats");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("accepts Bearer token in Authorization header", async () => {
    const res = await request(app).get("/api/stats").set("Authorization", `Bearer ${AUTH}`);
    expect(res.status).toBe(200);
  });

  it("accepts token as query parameter", async () => {
    const res = await request(app).get(`/api/stats?token=${AUTH}`);
    expect(res.status).toBe(200);
  });

  it("rejects wrong token", async () => {
    const res = await request(app).get("/api/stats").set("Authorization", "Bearer wrong-token");
    expect(res.status).toBe(401);
  });
});

describe("GET /health", () => {
  it("returns ok without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("gasBalance");
  });
});

describe("GET /api/stats", () => {
  it("returns stats object with correct shape", async () => {
    const res = await request(app).get("/api/stats").set("Authorization", `Bearer ${AUTH}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("totalAccounts");
    expect(res.body).toHaveProperty("uniqueMasters");
    expect(res.body).toHaveProperty("deployedAccounts");
    expect(res.body).toHaveProperty("undeployedAccounts");
    expect(res.body).toHaveProperty("totalSweeps");
    expect(res.body).toHaveProperty("recentSweeps");
    expect(Array.isArray(res.body.recentSweeps)).toBe(true);
  });
});

describe("POST /api/create", () => {
  it("rejects invalid master address", async () => {
    const res = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ master: "not-an-address", count: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid master/i);
  });

  it("rejects count > 5", async () => {
    const res = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ master: "0xaabbccddee0011223344556677889900aabbccdd", count: 6 });
    expect(res.status).toBe(400);
  });

  it("creates accounts successfully", async () => {
    const master = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    vi.mocked(getVirtualAddress).mockImplementation(async () => uniqueAddr() as `0x${string}`);

    const res = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ master, count: 2 });

    expect(res.status).toBe(201);
    expect(res.body.accounts).toHaveLength(2);
    expect(res.body.accounts[0]).toHaveProperty("address");
    expect(res.body.accounts[0]).toHaveProperty("index");
    expect(res.body.accounts[0].master).toBe(master);
    expect(res.body.accounts[0].deployed).toBe(false);
  });

  it("enforces 5-account limit per master", async () => {
    const master = "0x1234567890abcdef1234567890abcdef12345678";
    vi.mocked(getVirtualAddress).mockImplementation(async () => uniqueAddr() as `0x${string}`);

    // Create 5
    const first = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ master, count: 5 });
    expect(first.status).toBe(201);
    expect(first.body.accounts).toHaveLength(5);

    // Try to create 1 more — should be rejected
    const res = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ master, count: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/limit|maximum/i);
  });
});

describe("GET /api/accounts/:master", () => {
  it("rejects invalid address", async () => {
    const res = await request(app)
      .get("/api/accounts/not-valid")
      .set("Authorization", `Bearer ${AUTH}`);
    expect(res.status).toBe(400);
  });

  it("returns empty array for unknown master", async () => {
    // Use all-lowercase to avoid EIP-55 checksum issues
    const res = await request(app)
      .get("/api/accounts/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
      .set("Authorization", `Bearer ${AUTH}`);
    expect(res.status).toBe(200);
    expect(res.body.accounts).toEqual([]);
  });
});

describe("POST /api/sweep", () => {
  it("rejects invalid address", async () => {
    const res = await request(app)
      .post("/api/sweep")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ account: "bad" });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown account", async () => {
    const res = await request(app)
      .post("/api/sweep")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ account: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" });
    expect(res.status).toBe(404);
  });

  it("sweeps a known account with balances", async () => {
    // First create an account with a unique address
    const cloneAddr = uniqueAddr();
    vi.mocked(getVirtualAddress).mockResolvedValue(cloneAddr as `0x${string}`);

    const master = "0xabcdabcdabcdabcdabcdabcdabcdabcdabcdabcd";
    await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ master, count: 1 });

    // Mock indexer to return a balance
    vi.mocked(getBalances).mockResolvedValueOnce([
      {
        contractAddress: "0x0000000000000000000000000000000000000000",
        accountAddress: cloneAddr,
        balance: "1000000000000000000",
      },
    ]);
    vi.mocked(sendDeployAndSweep).mockResolvedValueOnce("0xfaketxhash123" as `0x${string}`);

    const res = await request(app)
      .post("/api/sweep")
      .set("Authorization", `Bearer ${AUTH}`)
      .send({ account: cloneAddr });

    expect(res.status).toBe(200);
    expect(res.body.swept).toBe(true);
    expect(res.body.txHash).toBe("0xfaketxhash123");
  });
});

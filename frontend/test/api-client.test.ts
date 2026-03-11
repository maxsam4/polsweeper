import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock import.meta.env before importing the module
vi.stubEnv("VITE_API_URL", "http://localhost:3101");
vi.stubEnv("VITE_AUTH_TOKEN", "test-token");

// We need to dynamically import after stubbing env
let getAccounts: typeof import("../src/api/client").getAccounts;
let createAccounts: typeof import("../src/api/client").createAccounts;
let sweepAccount: typeof import("../src/api/client").sweepAccount;
let getStats: typeof import("../src/api/client").getStats;

beforeEach(async () => {
  vi.restoreAllMocks();
  // Re-import to pick up env stubs
  const mod = await import("../src/api/client");
  getAccounts = mod.getAccounts;
  createAccounts = mod.createAccounts;
  sweepAccount = mod.sweepAccount;
  getStats = mod.getStats;
});

describe("API client", () => {
  it("getAccounts sends correct request", async () => {
    const mockResponse = { accounts: [{ address: "0x123", index: 0 }] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await getAccounts("0xABCD");
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain("/api/accounts/0xABCD");
    expect((opts as RequestInit).method).toBe("GET");
    expect((opts as RequestInit).headers).toHaveProperty("Authorization");
  });

  it("createAccounts sends POST with body", async () => {
    const mockResponse = { accounts: [], total: 1 };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    await createAccounts("0xABCD", 2);
    const [url, opts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain("/api/create");
    expect((opts as RequestInit).method).toBe("POST");
    expect(JSON.parse((opts as RequestInit).body as string)).toEqual({
      master: "0xABCD",
      count: 2,
    });
  });

  it("sweepAccount sends POST with account address", async () => {
    const mockResponse = { swept: true, txHash: "0xabc", tokens: ["POL"] };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await sweepAccount("0x1234");
    expect(result.swept).toBe(true);
    expect(result.txHash).toBe("0xabc");
  });

  it("getStats sends GET to /api/stats", async () => {
    const mockResponse = {
      totalAccounts: 5,
      uniqueMasters: 2,
      deployedAccounts: 3,
      undeployedAccounts: 2,
      totalSweeps: 10,
      recentSweeps: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await getStats();
    expect(result.totalAccounts).toBe(5);
    expect(result.uniqueMasters).toBe(2);
    expect(result.totalSweeps).toBe(10);

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toContain("/api/stats");
  });

  it("throws on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(getStats()).rejects.toThrow("Unauthorized");
  });
});

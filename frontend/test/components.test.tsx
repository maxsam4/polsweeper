import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Mock the API client
vi.mock("../src/api/client", () => ({
  getAccounts: vi.fn(),
  createAccounts: vi.fn(),
  sweepAccount: vi.fn(),
  getStats: vi.fn(),
}));

import { getAccounts, createAccounts, getStats } from "../src/api/client";
import App from "../src/App";
import AddressInput from "../src/components/AddressInput";
import CreatePanel from "../src/components/CreatePanel";
import AccountList from "../src/components/AccountList";
import StatsPanel from "../src/components/StatsPanel";

describe("AddressInput", () => {
  it("renders input and button", () => {
    render(<AddressInput onSubmit={() => {}} loading={false} />);
    expect(screen.getByPlaceholderText(/polygon address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /load/i })).toBeInTheDocument();
  });

  it("disables button for invalid address", () => {
    render(<AddressInput onSubmit={() => {}} loading={false} />);
    const btn = screen.getByRole("button", { name: /load/i });
    expect(btn).toBeDisabled();
  });

  it("enables button for valid address", async () => {
    const user = userEvent.setup();
    render(<AddressInput onSubmit={() => {}} loading={false} />);
    const input = screen.getByPlaceholderText(/polygon address/i);
    await user.type(input, "0xaAbBcCdDeE0011223344556677889900AaBbCcDd");
    const btn = screen.getByRole("button", { name: /load/i });
    expect(btn).not.toBeDisabled();
  });

  it("calls onSubmit with address on form submit", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<AddressInput onSubmit={onSubmit} loading={false} />);
    const input = screen.getByPlaceholderText(/polygon address/i);
    await user.type(input, "0xaAbBcCdDeE0011223344556677889900AaBbCcDd");
    await user.click(screen.getByRole("button", { name: /load/i }));
    expect(onSubmit).toHaveBeenCalledWith("0xaAbBcCdDeE0011223344556677889900AaBbCcDd");
  });

  it("shows spinner when loading", () => {
    render(<AddressInput onSubmit={() => {}} loading={true} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});

describe("CreatePanel", () => {
  it("shows usage count", () => {
    render(
      <CreatePanel currentCount={2} maxCount={5} loading={false} onCreate={() => {}} />
    );
    const usage = screen.getByText(/of 5 accounts used/i);
    expect(usage).toBeInTheDocument();
    expect(usage.querySelector("strong")!.textContent).toBe("2");
  });

  it("shows limit message when at max", () => {
    render(
      <CreatePanel currentCount={5} maxCount={5} loading={false} onCreate={() => {}} />
    );
    expect(screen.getByText(/limit reached/i)).toBeInTheDocument();
  });

  it("calls onCreate with selected count", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <CreatePanel currentCount={0} maxCount={5} loading={false} onCreate={onCreate} />
    );
    // Click count button "3"
    await user.click(screen.getByText("3"));
    await user.click(screen.getByRole("button", { name: /create/i }));
    expect(onCreate).toHaveBeenCalledWith(3);
  });
});

describe("AccountList", () => {
  it("shows empty message when no accounts", () => {
    render(<AccountList accounts={[]} />);
    expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
  });

  it("renders account cards", () => {
    const accounts = [
      {
        address: "0x1111111111111111111111111111111111111111",
        index: 0,
        master: "0xaaaa000000000000000000000000000000000001",
        deployed: true,
        createdAt: "2024-01-01T00:00:00Z",
        balances: [],
      },
    ];
    render(<AccountList accounts={accounts} />);
    expect(screen.getByText("#0")).toBeInTheDocument();
    expect(screen.getByText("Deployed")).toBeInTheDocument();
  });
});

describe("StatsPanel", () => {
  beforeEach(() => {
    vi.mocked(getStats).mockReset();
  });

  it("shows loading spinner initially", () => {
    vi.mocked(getStats).mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = render(<StatsPanel />);
    expect(container.querySelector(".spinner")).toBeInTheDocument();
  });

  it("renders stats after loading", async () => {
    vi.mocked(getStats).mockResolvedValue({
      totalAccounts: 10,
      uniqueMasters: 3,
      deployedAccounts: 7,
      undeployedAccounts: 3,
      totalSweeps: 25,
      recentSweeps: [],
    });

    render(<StatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("10")).toBeInTheDocument();
    });
    expect(screen.getByText("3")).toBeInTheDocument(); // uniqueMasters
    expect(screen.getByText("7")).toBeInTheDocument(); // deployed
    expect(screen.getByText("25")).toBeInTheDocument(); // totalSweeps
    expect(screen.getByText(/no sweeps recorded/i)).toBeInTheDocument();
  });

  it("renders recent sweeps with tx links", async () => {
    vi.mocked(getStats).mockResolvedValue({
      totalAccounts: 42,
      uniqueMasters: 8,
      deployedAccounts: 30,
      undeployedAccounts: 12,
      totalSweeps: 99,
      recentSweeps: [
        {
          id: 1,
          account_address: "0x1111111111111111111111111111111111111111",
          master: "0xaaaa000000000000000000000000000000000001",
          tx_hash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          tokens_swept: ["POL (native)", "USDC"],
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    render(<StatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });

    // Check tx link exists
    const link = screen.getByText(/0xabcdef/i);
    expect(link).toBeInTheDocument();
    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("polygonscan.com/tx/")
    );

    // Check token count
    expect(screen.getByText("2 tokens")).toBeInTheDocument();
  });

  it("shows error message on failure", async () => {
    vi.mocked(getStats).mockRejectedValue(new Error("Network error"));
    render(<StatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("has a refresh button", async () => {
    vi.mocked(getStats).mockResolvedValue({
      totalAccounts: 0,
      uniqueMasters: 0,
      deployedAccounts: 0,
      undeployedAccounts: 0,
      totalSweeps: 0,
      recentSweeps: [],
    });

    render(<StatsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Refresh")).toBeInTheDocument();
    });
  });
});

describe("App", () => {
  beforeEach(() => {
    vi.mocked(getAccounts).mockResolvedValue([]);
    vi.mocked(getStats).mockResolvedValue({
      totalAccounts: 0,
      uniqueMasters: 0,
      deployedAccounts: 0,
      undeployedAccounts: 0,
      totalSweeps: 0,
      recentSweeps: [],
    });
  });

  it("renders header and nav tabs", () => {
    render(<App />);
    expect(screen.getByText("polsweeper")).toBeInTheDocument();
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
  });

  it("shows accounts view by default", () => {
    render(<App />);
    expect(screen.getByText("Master Address")).toBeInTheDocument();
  });

  it("switches to stats view on tab click", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("Stats"));
    await waitFor(() => {
      expect(screen.getByText("System Overview")).toBeInTheDocument();
    });
  });

  it("switches back to accounts view", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByText("Stats"));
    await user.click(screen.getByText("Accounts"));
    expect(screen.getByText("Master Address")).toBeInTheDocument();
  });
});

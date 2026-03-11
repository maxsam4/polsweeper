import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("../src/api/client", () => ({
  sweepAccount: vi.fn(),
}));

import AccountCard from "../src/components/AccountCard";
import type { Account } from "../src/types";

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    address: "0x1111111111111111111111111111111111111111",
    index: 0,
    master: "0xaaaa000000000000000000000000000000000001",
    deployed: false,
    createdAt: "2024-01-01T00:00:00Z",
    balances: [],
    ...overrides,
  };
}

describe("AccountCard", () => {
  it("renders account index", () => {
    render(<AccountCard account={makeAccount({ index: 3 })} animationDelay={0} />);
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  it("renders full address as polygonscan link", () => {
    const addr = "0x1111111111111111111111111111111111111111";
    render(<AccountCard account={makeAccount({ address: addr })} animationDelay={0} />);
    const link = screen.getByText(addr).closest("a");
    expect(link).toHaveAttribute("href", `https://polygonscan.com/address/${addr}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows Deployed status when deployed", () => {
    render(<AccountCard account={makeAccount({ deployed: true })} animationDelay={0} />);
    expect(screen.getByText("Deployed")).toBeInTheDocument();
  });

  it("shows Pending status when not deployed", () => {
    render(<AccountCard account={makeAccount({ deployed: false })} animationDelay={0} />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("shows 'No token balances' when balances empty", () => {
    render(<AccountCard account={makeAccount({ balances: [] })} animationDelay={0} />);
    expect(screen.getByText("No token balances")).toBeInTheDocument();
  });

  it("renders token balances with symbol", () => {
    const account = makeAccount({
      balances: [
        { contractAddress: "0xtoken1", balance: "1000000000000000000", symbol: "USDC", decimals: 18 },
      ],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("1.0000")).toBeInTheDocument();
  });

  it("renders truncated address when no symbol", () => {
    const account = makeAccount({
      balances: [
        { contractAddress: "0xabcdef1234567890abcdef1234567890abcdef12", balance: "500000000000000000" },
      ],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    // truncateToken: first 6 + ... + last 4
    expect(screen.getByText("0xabcd...ef12")).toBeInTheDocument();
  });

  it("formats balance with custom decimals", () => {
    const account = makeAccount({
      balances: [
        { contractAddress: "0xusdc", balance: "1000000", symbol: "USDC", decimals: 6 },
      ],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    expect(screen.getByText("1.0000")).toBeInTheDocument();
  });

  it("formats zero balance", () => {
    const account = makeAccount({
      balances: [
        { contractAddress: "0xtoken", balance: "0", symbol: "TKN" },
      ],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    expect(screen.getByText("0.0000")).toBeInTheDocument();
  });

  it("formats large balance", () => {
    const account = makeAccount({
      balances: [
        {
          contractAddress: "0xtoken",
          balance: "123456789012345678901234", // ~123,456.789...
          symbol: "BIG",
          decimals: 18,
        },
      ],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    // Whole part should be locale-formatted
    const balanceEl = screen.getByText(/123/);
    expect(balanceEl).toBeInTheDocument();
  });

  it("renders copy button", () => {
    render(<AccountCard account={makeAccount()} animationDelay={0} />);
    expect(screen.getByLabelText("Copy address")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("renders sweep button", () => {
    render(<AccountCard account={makeAccount()} animationDelay={0} />);
    expect(screen.getByRole("button", { name: /sweep/i })).toBeInTheDocument();
  });

  it("disables sweep button when no balances", () => {
    render(<AccountCard account={makeAccount({ balances: [] })} animationDelay={0} />);
    expect(screen.getByRole("button", { name: /sweep/i })).toBeDisabled();
  });

  it("enables sweep button when has balances", () => {
    const account = makeAccount({
      balances: [{ contractAddress: "0xtoken", balance: "1000", symbol: "TKN" }],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    expect(screen.getByRole("button", { name: /sweep/i })).not.toBeDisabled();
  });

  it("applies animation delay style", () => {
    const { container } = render(<AccountCard account={makeAccount()} animationDelay={120} />);
    const card = container.querySelector("article");
    expect(card).toHaveStyle({ animationDelay: "120ms" });
  });

  it("renders multiple balances", () => {
    const account = makeAccount({
      balances: [
        { contractAddress: "0xtoken1", balance: "1000000000000000000", symbol: "USDC" },
        { contractAddress: "0xtoken2", balance: "2000000000000000000", symbol: "WETH" },
      ],
    });
    render(<AccountCard account={account} animationDelay={0} />);
    expect(screen.getByText("USDC")).toBeInTheDocument();
    expect(screen.getByText("WETH")).toBeInTheDocument();
  });
});

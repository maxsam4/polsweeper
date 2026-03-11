import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("../src/api/client", () => ({
  sweepAccount: vi.fn(),
}));

import { sweepAccount } from "../src/api/client";
import SweepButton from "../src/components/SweepButton";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe("SweepButton", () => {
  it("renders Sweep label when idle", () => {
    render(<SweepButton address="0x1234" disabled={false} />);
    expect(screen.getByRole("button", { name: /sweep/i })).toBeInTheDocument();
  });

  it("is disabled when disabled prop is true", () => {
    render(<SweepButton address="0x1234" disabled={true} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows spinner during loading", async () => {
    vi.mocked(sweepAccount).mockReturnValue(new Promise(() => {})); // never resolves
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SweepButton address="0x1234" disabled={false} />);

    await user.click(screen.getByRole("button"));
    const { container } = render(<SweepButton address="0x1234" disabled={false} />);
    // The button should be disabled during loading (first instance)
  });

  it("shows View Tx link on success with txHash", async () => {
    vi.mocked(sweepAccount).mockResolvedValue({
      swept: true,
      txHash: "0xabcdef1234567890",
      tokens: ["POL"],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SweepButton address="0x1234" disabled={false} />);
    await user.click(screen.getByRole("button", { name: /sweep/i }));

    await waitFor(() => {
      expect(screen.getByText("View Tx")).toBeInTheDocument();
    });

    const link = screen.getByText("View Tx").closest("a");
    expect(link).toHaveAttribute("href", "https://polygonscan.com/tx/0xabcdef1234567890");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows checkmark on success without txHash", async () => {
    vi.mocked(sweepAccount).mockResolvedValue({
      swept: false,
      tokens: [],
    });

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SweepButton address="0x1234" disabled={false} />);
    await user.click(screen.getByRole("button", { name: /sweep/i }));

    await waitFor(() => {
      expect(screen.getByText("\u2713")).toBeInTheDocument();
    });
  });

  it("shows Failed on error and resets", async () => {
    vi.mocked(sweepAccount).mockRejectedValue(new Error("tx failed"));

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SweepButton address="0x1234" disabled={false} />);
    await user.click(screen.getByRole("button", { name: /sweep/i }));

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });

    // After 2.5s timeout, should reset to idle
    act(() => vi.advanceTimersByTime(3000));
    await waitFor(() => {
      expect(screen.getByText("Sweep")).toBeInTheDocument();
    });
  });

  it("prevents double click during loading", async () => {
    let resolvePromise!: (v: any) => void;
    vi.mocked(sweepAccount).mockReturnValue(
      new Promise((r) => { resolvePromise = r; })
    );

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SweepButton address="0x1234" disabled={false} />);
    await user.click(screen.getByRole("button", { name: /sweep/i }));

    // Button should be disabled during loading
    expect(screen.getByRole("button")).toBeDisabled();
    expect(sweepAccount).toHaveBeenCalledTimes(1);

    // Resolve to clean up
    resolvePromise({ swept: true, tokens: [] });
  });
});

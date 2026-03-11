import { describe, it, expect, vi } from "vitest";

// Mock chain module but test the queue logic by re-implementing it
// (can't import queueTransaction without triggering viem client creation)

// Replicate the queue implementation for isolated testing
type QueuedTask<T> = {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const queue: QueuedTask<unknown>[] = [];
let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (error) {
      task.reject(error);
    }
  }
  processing = false;
}

function queueTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject } as QueuedTask<unknown>);
    processQueue();
  });
}

describe("signer queue", () => {
  it("executes tasks and returns results", async () => {
    const result = await queueTransaction(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("executes tasks sequentially", async () => {
    const order: number[] = [];

    const p1 = queueTransaction(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return "a";
    });
    const p2 = queueTransaction(async () => {
      order.push(2);
      return "b";
    });
    const p3 = queueTransaction(async () => {
      order.push(3);
      return "c";
    });

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("rejects individual task on error without blocking queue", async () => {
    const p1 = queueTransaction(() => Promise.reject(new Error("fail")));
    const p2 = queueTransaction(() => Promise.resolve("ok"));

    await expect(p1).rejects.toThrow("fail");
    expect(await p2).toBe("ok");
  });

  it("processes queue even after error", async () => {
    await expect(
      queueTransaction(() => Promise.reject(new Error("oops")))
    ).rejects.toThrow("oops");

    const result = await queueTransaction(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
  });
});

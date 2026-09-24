import { describe, expect, it } from "vitest";
import { WorkQueue } from "../work-queue.js";

describe("WorkQueue", () => {
  it("never runs more than `concurrency` jobs at once and drains every accepted job", async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    const queue = new WorkQueue<number>(
      async (n) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        done.push(n);
      },
      { concurrency: 2, limit: 10 },
    );

    for (let n = 0; n < 6; n++) expect(queue.enqueue(n)).toBe(true);
    await queue.drain();

    expect(peak).toBe(2);
    expect(done.sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("refuses jobs beyond the waiting limit and after close", async () => {
    const queue = new WorkQueue<number>(() => new Promise(() => undefined), {
      concurrency: 1,
      limit: 1,
    });

    expect(queue.enqueue(1)).toBe(true); // running
    expect(queue.enqueue(2)).toBe(true); // waiting
    expect(queue.isFull).toBe(true);
    expect(queue.enqueue(3)).toBe(false);
  });

  it("survives a worker that rejects", async () => {
    const queue = new WorkQueue<number>(
      async (n) => {
        if (n === 1) throw new Error("bug");
      },
      { concurrency: 1, limit: 5 },
    );
    queue.enqueue(1);
    queue.enqueue(2);
    await queue.close();
    expect(queue.size).toBe(0);
    expect(queue.enqueue(3)).toBe(false);
  });
});

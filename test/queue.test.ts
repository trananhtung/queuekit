import { describe, it, expect, vi } from "vitest";
import { Queue, QueueClearedError } from "../src/index.js";

/** A promise you can resolve from the outside — used to hold tasks open. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("Queue — basics", () => {
  it("runs a task and resolves with its value", async () => {
    const queue = new Queue();
    await expect(queue.add(() => 42)).resolves.toBe(42);
    await expect(queue.add(async () => "hi")).resolves.toBe("hi");
  });

  it("propagates a task rejection without stalling the queue", async () => {
    const queue = new Queue({ concurrency: 1 });
    const bad = queue.add(() => Promise.reject(new Error("boom")));
    const good = queue.add(() => "ok");
    await expect(bad).rejects.toThrow("boom");
    await expect(good).resolves.toBe("ok");
  });

  it("addAll resolves to results in order", async () => {
    const queue = new Queue({ concurrency: 2 });
    await expect(queue.addAll([() => 1, () => 2, () => 3])).resolves.toEqual([1, 2, 3]);
  });
});

describe("Queue — concurrency", () => {
  it("never exceeds the concurrency limit", async () => {
    const queue = new Queue({ concurrency: 2 });
    let active = 0;
    let maxActive = 0;
    const gates = [deferred(), deferred(), deferred(), deferred()];

    const tasks = gates.map((g, i) =>
      queue.add(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await g.promise;
        active--;
        return i;
      }),
    );

    await tick();
    expect(queue.pending).toBe(2);
    expect(queue.size).toBe(2);

    for (const g of gates) {
      g.resolve();
      await tick();
    }
    await Promise.all(tasks);
    expect(maxActive).toBe(2);
  });

  it("raising concurrency starts more eligible tasks immediately", async () => {
    const queue = new Queue({ concurrency: 1 });
    const gates = [deferred(), deferred(), deferred()];
    gates.forEach((g) => queue.add(() => g.promise));
    await tick();
    expect(queue.pending).toBe(1);
    queue.concurrency = 3;
    await tick();
    expect(queue.pending).toBe(3);
    gates.forEach((g) => g.resolve());
  });
});

describe("Queue — priority", () => {
  it("higher priority runs first, ties keep FIFO", async () => {
    const queue = new Queue({ concurrency: 1, autoStart: false });
    const order: string[] = [];
    queue.add(() => void order.push("a")); // priority 0
    queue.add(() => void order.push("b"), { priority: 0 });
    queue.add(() => void order.push("c"), { priority: 10 });
    queue.add(() => void order.push("d"), { priority: 5 });
    queue.start();
    await queue.onIdle();
    expect(order).toEqual(["c", "d", "a", "b"]);
  });
});

describe("Queue — pause / start / clear", () => {
  it("autoStart:false stages tasks until start()", async () => {
    const queue = new Queue({ autoStart: false });
    const spy = vi.fn();
    queue.add(spy);
    await tick();
    expect(spy).not.toHaveBeenCalled();
    expect(queue.isPaused).toBe(true);
    queue.start();
    await queue.onIdle();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("pause stops new tasks but lets in-flight finish", async () => {
    const queue = new Queue({ concurrency: 1 });
    const g = deferred();
    const running = queue.add(() => g.promise);
    const queued = queue.add(() => "later");
    await tick();
    queue.pause();
    g.resolve();
    await running;
    await tick();
    expect(queue.size).toBe(1); // still queued, not started
    queue.start();
    await expect(queued).resolves.toBe("later");
  });

  it("clear rejects pending tasks with QueueClearedError", async () => {
    const queue = new Queue({ concurrency: 1 });
    const g = deferred();
    const running = queue.add(() => g.promise);
    const dropped = queue.add(() => "never");
    await tick();
    queue.clear();
    await expect(dropped).rejects.toBeInstanceOf(QueueClearedError);
    expect(queue.size).toBe(0);
    g.resolve();
    await running;
  });
});

describe("Queue — onEmpty / onIdle", () => {
  it("onEmpty resolves when nothing is waiting, onIdle when fully drained", async () => {
    const queue = new Queue({ concurrency: 1 });
    const g = deferred();
    queue.add(() => g.promise);
    queue.add(() => "second");

    let emptyAt = -1;
    let idleAt = -1;
    let step = 0;
    void queue.onEmpty().then(() => (emptyAt = ++step));
    void queue.onIdle().then(() => (idleAt = ++step));

    await tick();
    expect(emptyAt).toBe(-1); // one task still queued
    g.resolve();
    await queue.onIdle();
    expect(emptyAt).toBeGreaterThan(0);
    expect(idleAt).toBeGreaterThan(emptyAt); // empty fires before idle
  });

  it("onIdle resolves immediately for an empty queue", async () => {
    await expect(new Queue().onIdle()).resolves.toBeUndefined();
  });
});

describe("Queue — AbortSignal", () => {
  it("a per-task signal cancels it while queued", async () => {
    const queue = new Queue({ concurrency: 1 });
    const g = deferred();
    queue.add(() => g.promise);
    const ac = new AbortController();
    const cancelled = queue.add(() => "x", { signal: ac.signal });
    await tick();
    ac.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(queue.size).toBe(0);
    g.resolve();
  });

  it("an already-aborted task signal rejects add immediately", async () => {
    const queue = new Queue();
    await expect(queue.add(() => 1, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("a queue-level signal clears pending and blocks new adds", async () => {
    const ac = new AbortController();
    const queue = new Queue({ concurrency: 1, signal: ac.signal });
    const g = deferred();
    const running = queue.add(() => g.promise);
    const pending = queue.add(() => "x");
    await tick();
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(queue.add(() => 1)).rejects.toMatchObject({ name: "AbortError" });
    g.resolve();
    await running; // in-flight task still completes
  });
});

describe("Queue — validation", () => {
  it("rejects concurrency < 1", () => {
    expect(() => new Queue({ concurrency: 0 })).toThrow(RangeError);
    const q = new Queue();
    expect(() => (q.concurrency = 0)).toThrow(RangeError);
  });
});

/** A unit of work. May be sync or async; its resolved value flows out of `add`. */
export type Task<T> = () => T | Promise<T>;

export interface QueueOptions {
  /** Maximum tasks running at once. Default `Infinity`. */
  concurrency?: number;
  /** Begin processing as tasks are added. Default `true`; set `false` to stage work. */
  autoStart?: boolean;
  /** Abort clears all pending tasks and blocks further `add`s. In-flight tasks finish. */
  signal?: AbortSignal;
}

export interface AddOptions {
  /** Higher runs first; ties keep FIFO order. Default `0`. */
  priority?: number;
  /** Cancel *this* task while it is still queued (rejects its promise). */
  signal?: AbortSignal;
}

/** Thrown into a task's promise when {@link Queue.clear} drops it before it runs. */
export class QueueClearedError extends Error {
  constructor() {
    super("Task was removed because the queue was cleared");
    this.name = "QueueClearedError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

interface QueueItem {
  priority: number;
  start: () => void;
  reject: (reason: unknown) => void;
  detach: () => void;
}

/**
 * A promise-based async task queue: add work over time, bound how much runs at
 * once, prioritize, pause/resume, and await drain. Zero dependencies.
 *
 * Unlike a map-over-a-list helper, a `Queue` is *stateful* — tasks can be added
 * at any moment and each `add()` returns a promise for that task's result.
 *
 * ```ts
 * const queue = new Queue({ concurrency: 2 });
 * const results = await Promise.all(urls.map((u) => queue.add(() => fetch(u))));
 * await queue.onIdle(); // everything settled
 * ```
 */
export class Queue {
  #items: QueueItem[] = [];
  #pending = 0;
  #concurrency: number;
  #paused: boolean;
  #aborted = false;
  #emptyResolvers: Array<() => void> = [];
  #idleResolvers: Array<() => void> = [];

  constructor(options: QueueOptions = {}) {
    const concurrency = options.concurrency ?? Infinity;
    if (concurrency < 1) throw new RangeError("concurrency must be >= 1");
    this.#concurrency = concurrency;
    this.#paused = options.autoStart === false;

    const signal = options.signal;
    if (signal) {
      if (signal.aborted) this.#aborted = true;
      else
        signal.addEventListener(
          "abort",
          () => {
            this.#aborted = true;
            this.#clear(abortReason(signal));
          },
          { once: true },
        );
    }
  }

  /** Number of tasks waiting to start (not yet running). */
  get size(): number {
    return this.#items.length;
  }

  /** Number of tasks currently running. */
  get pending(): number {
    return this.#pending;
  }

  /** Whether processing is paused. */
  get isPaused(): boolean {
    return this.#paused;
  }

  /** Max concurrent tasks. Raising it immediately starts more eligible tasks. */
  get concurrency(): number {
    return this.#concurrency;
  }
  set concurrency(value: number) {
    if (value < 1) throw new RangeError("concurrency must be >= 1");
    this.#concurrency = value;
    this.#next();
  }

  /** Enqueue a task; resolves/rejects with its outcome. */
  add<T>(task: Task<T>, options: AddOptions = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.#aborted) {
        reject(new DOMException("The operation was aborted", "AbortError"));
        return;
      }
      const taskSignal = options.signal;
      if (taskSignal?.aborted) {
        reject(abortReason(taskSignal));
        return;
      }

      const item: QueueItem = {
        priority: options.priority ?? 0,
        reject,
        detach: () => {
          if (taskSignal && onAbort) taskSignal.removeEventListener("abort", onAbort);
        },
        start: () => {
          item.detach();
          this.#pending++;
          (async () => {
            try {
              resolve(await task());
            } catch (error) {
              reject(error);
            } finally {
              this.#pending--;
              this.#next();
              this.#settle();
            }
          })();
        },
      };

      const onAbort = taskSignal
        ? () => {
            const index = this.#items.indexOf(item);
            if (index !== -1) {
              this.#items.splice(index, 1);
              reject(abortReason(taskSignal));
              this.#settle();
            }
          }
        : undefined;
      if (taskSignal && onAbort) taskSignal.addEventListener("abort", onAbort, { once: true });

      this.#enqueue(item);
      this.#next();
    });
  }

  /** Enqueue many tasks at once; resolves with their results in order. */
  addAll<T>(tasks: ReadonlyArray<Task<T>>, options: AddOptions = {}): Promise<T[]> {
    return Promise.all(tasks.map((task) => this.add(task, options)));
  }

  /** Resume processing after {@link pause} (or an `autoStart: false` start). */
  start(): this {
    if (this.#paused) {
      this.#paused = false;
      this.#next();
    }
    return this;
  }

  /** Stop starting new tasks. In-flight tasks keep running. */
  pause(): this {
    this.#paused = true;
    return this;
  }

  /** Drop every pending (not-yet-started) task, rejecting each with {@link QueueClearedError}. */
  clear(): void {
    this.#clear(new QueueClearedError());
  }

  /** Resolves when no tasks are waiting (running tasks may remain). */
  onEmpty(): Promise<void> {
    if (this.#items.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#emptyResolvers.push(resolve));
  }

  /** Resolves when the queue is fully drained — nothing waiting and nothing running. */
  onIdle(): Promise<void> {
    if (this.#items.length === 0 && this.#pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleResolvers.push(resolve));
  }

  #enqueue(item: QueueItem): void {
    let i = this.#items.length;
    while (i > 0 && (this.#items[i - 1] as QueueItem).priority < item.priority) i--;
    this.#items.splice(i, 0, item);
  }

  #next(): void {
    if (this.#paused) return;
    while (this.#pending < this.#concurrency && this.#items.length > 0) {
      const item = this.#items.shift() as QueueItem;
      item.start();
    }
    this.#settle();
  }

  #settle(): void {
    if (this.#items.length === 0) {
      for (const resolve of this.#emptyResolvers.splice(0)) resolve();
      if (this.#pending === 0) for (const resolve of this.#idleResolvers.splice(0)) resolve();
    }
  }

  #clear(reason: unknown): void {
    const dropped = this.#items.splice(0);
    for (const item of dropped) {
      item.detach();
      item.reject(reason);
    }
    this.#settle();
  }
}

/**
 * Bounded in-process work queue: at most `concurrency` jobs run at once, at
 * most `limit` wait, and the rest are refused so the caller can shed load
 * (503) instead of queueing without bound.
 *
 * Deliberately not durable: the database row is the durable record of the
 * work, and the service re-enqueues pending rows at boot (see
 * ActionExecutor.recover). That keeps the demo free of Redis while making the
 * one real gap (a crash loses in-flight runs, which are then marked
 * interrupted) explicit. Moving to BullMQ means replacing this class with a
 * queue client and the worker with a job processor; nothing else changes.
 */
export class WorkQueue<T> {
  private readonly waiting: T[] = [];
  private running = 0;
  private closed = false;
  private idleWaiters: Array<() => void> = [];

  constructor(
    private readonly worker: (item: T) => Promise<void>,
    private readonly options: { concurrency: number; limit: number },
  ) {}

  /** Jobs waiting plus jobs running. */
  get size(): number {
    return this.waiting.length + this.running;
  }

  get isFull(): boolean {
    return this.waiting.length >= this.options.limit;
  }

  /** Returns false when the queue is full or closed; the job was not accepted. */
  enqueue(item: T): boolean {
    if (this.closed || this.isFull) return false;
    this.waiting.push(item);
    this.pump();
    return true;
  }

  /** Stops accepting jobs and resolves once everything accepted has finished. */
  async close(): Promise<void> {
    this.closed = true;
    await this.drain();
  }

  /** Resolves when no job is waiting or running. */
  drain(): Promise<void> {
    if (this.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running < this.options.concurrency && this.waiting.length > 0) {
      const item = this.waiting.shift()!;
      this.running++;
      // The worker owns its error handling; a rejection here is a bug in it,
      // and must not take the queue down with it.
      void this.worker(item)
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.pump();
          if (this.size === 0) {
            const waiters = this.idleWaiters;
            this.idleWaiters = [];
            waiters.forEach((resolve) => resolve());
          }
        });
    }
  }
}

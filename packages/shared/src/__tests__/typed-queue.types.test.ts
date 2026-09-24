import { describe, expectTypeOf, it } from "vitest";
import { JobNames, TypedQueueClient, type JobName, type JobPayloadMap } from "../jobs";
import type { JobContext } from "../queue";

// These assertions are checked by the compiler (`npm run check-types`), not at
// runtime: they pin the producer/consumer contract that TypedQueueClient enforces.
describe("TypedQueueClient contracts", () => {
  it("keeps the registry and payload map in sync", () => {
    expectTypeOf<keyof JobPayloadMap>().toEqualTypeOf<JobName>();
  });

  it("ties each job name to exactly its payload type", () => {
    const queue = null as unknown as TypedQueueClient;
    const typecheckOnly = () => {
      void queue.enqueue(JobNames.CLEANUP, { id: 1, executionType: "DELETE" });
      // @ts-expect-error — wrong payload shape for this job
      void queue.enqueue(JobNames.CLEANUP, { automationId: 1 });
      // @ts-expect-error — executionType is a closed union, not any string
      void queue.enqueue(JobNames.CLEANUP, { id: 1, executionType: "whatever" });
      // @ts-expect-error — unknown job name
      void queue.enqueue("not.a.job", {});
      queue.process(JobNames.CLEANUP, async (job) => {
        expectTypeOf(job).toEqualTypeOf<JobContext<JobPayloadMap["cleanup"]>>();
      });
    };
    void typecheckOnly;
  });
});

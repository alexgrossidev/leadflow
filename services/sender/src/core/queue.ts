import { TypedQueueClient } from "@leadflow/shared/jobs";

export const queue = new TypedQueueClient();

/** The slice of the queue that producers need; tests pass an in-memory fake. */
export type Enqueuer = Pick<TypedQueueClient, "enqueue">;

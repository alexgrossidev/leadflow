import { queue } from "#core/queue";
import { sha256Hex } from "#core/secrets";
import { JobNames, type TypedQueueClient } from "@leadflow/shared/jobs";

type EnqueueQueue = Pick<TypedQueueClient, "enqueue">;

export class FacebookTokenService {
  constructor(private readonly jobs: EnqueueQueue = queue) {}

  /**
   * Hand the OAuth code to the exchange worker. The jobId is derived from the
   * code, so a double-submitted callback enqueues once. The code is single-use
   * and expires within minutes, so the completed job is removed immediately
   * rather than retained in Redis.
   */
  async exchangeToken(
    code: string,
    userId: number,
    businessId: number,
  ): Promise<void> {
    await this.jobs.enqueue(
      JobNames.FACEBOOK_EXCHANGE_TOKEN,
      { userId, businessId, accessToken: code, createdTime: Date.now() },
      {
        jobId: `fb_exchange_${userId}_${businessId}_${sha256Hex(code).slice(0, 16)}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { count: 100 },
      },
    );
  }
}

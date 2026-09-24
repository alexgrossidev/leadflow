import { status } from "@grpc/grpc-js";
import {
  GetLeadWithFiltersRequest,
  GrpcError,
  Lead,
  ServerWritableStream,
} from "@leadflow/rpc";
import { logger } from "#core/logger";
import { LeadStreamRepository } from "./lead.repo.js";
import { buildLeadFieldCondition, leadStreamRequestSchema } from "./lead.filter.js";

const BATCH_SIZE = 500;

type LeadCall = ServerWritableStream<GetLeadWithFiltersRequest, Lead>;

/** Resolves when the stream can take more data, or when the client went away. */
function waitForDrain(call: LeadCall): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      call.off("drain", done);
      call.off("cancelled", done);
      call.off("close", done);
      resolve();
    };
    call.once("drain", done);
    call.once("cancelled", done);
    call.once("close", done);
  });
}

export class LeadStreamingService {
  constructor(private readonly repo: LeadStreamRepository) {}

  /**
   * Server-streams the leads of a business matching the request's filter.
   * Pages are fetched lazily and each write respects backpressure, so a slow
   * client throttles the database reads instead of growing a buffer.
   * Errors are thrown, not written: the rpc middleware turns them into a
   * status via `call.destroy`, so `end()` is only called on success.
   */
  async getLeads(call: LeadCall): Promise<void> {
    const parsed = leadStreamRequestSchema.safeParse(call.request);
    if (!parsed.success) {
      throw new GrpcError(status.INVALID_ARGUMENT, "Invalid lead filter request");
    }
    const request = parsed.data;
    if (!(await this.repo.businessBelongsToUser(request.businessId, request.userId))) {
      throw new GrpcError(status.PERMISSION_DENIED, "Business does not belong to user");
    }
    const condition = request.type === "field" ? buildLeadFieldCondition(request) : undefined;

    let sent = 0;
    for await (const page of this.repo.pages(request.businessId, condition, BATCH_SIZE)) {
      for (const row of page) {
        if (call.cancelled) {
          logger.info({ businessId: request.businessId, sent }, "Lead stream cancelled by client");
          return;
        }
        const writable = call.write({
          id: String(row.id),
          name: row.name ?? "",
          email: row.email ?? "",
          phone: row.phone ?? "",
          status: row.status ?? "",
        });
        sent++;
        if (!writable) await waitForDrain(call);
      }
    }

    if (call.cancelled) return;
    call.end();
    logger.info({ businessId: request.businessId, sent }, "Lead stream completed");
  }
}

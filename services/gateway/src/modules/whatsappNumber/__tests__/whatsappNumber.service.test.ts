import { describe, it, expect, vi, beforeEach } from "vitest";
import { ZodError } from "zod";
import { eventNames } from "@leadflow/shared/eventBus";
import { WhatsappNumberService } from "../whatsappNumber.service.js";
import type { WhatsappNumberRepository } from "../whatsappNumber.repo.js";
import { whatsappNumberBodySchema } from "../whatsappNumber.schema.js";

const emitToWhatsapp = vi.hoisted(() => vi.fn());
vi.mock("#comms/bullmq/bullmq.eventEmitter", () => ({ emitToWhatsapp }));

describe("WhatsappNumberService", () => {
  let repo: { insert: ReturnType<typeof vi.fn>; deleteByBusinessPhone: ReturnType<typeof vi.fn> };
  let service: WhatsappNumberService;

  beforeEach(() => {
    vi.clearAllMocks();
    emitToWhatsapp.mockResolvedValue("job-1");
    repo = {
      insert: vi.fn().mockResolvedValue(undefined),
      deleteByBusinessPhone: vi.fn().mockResolvedValue(undefined),
    };
    service = new WhatsappNumberService(repo as unknown as WhatsappNumberRepository);
  });

  it("addNumber stores the number and emits WHATSAPP_NUMBER_ADDED", async () => {
    await service.addNumber(1, 2, "+39123456789");
    expect(repo.insert).toHaveBeenCalledWith({
      businessId: 1,
      userId: 2,
      phoneNumber: "+39123456789",
    });
    expect(emitToWhatsapp).toHaveBeenCalledWith(eventNames.WHATSAPP_NUMBER_ADDED, {
      userId: 2,
      businessId: 1,
      phoneNumber: "+39123456789",
    });
  });

  it("removeNumber deletes within the business and emits WHATSAPP_NUMBER_REMOVED", async () => {
    await service.removeNumber(1, 2, "+39123456789");
    expect(repo.deleteByBusinessPhone).toHaveBeenCalledWith(1, "+39123456789");
    expect(emitToWhatsapp).toHaveBeenCalledWith(eventNames.WHATSAPP_NUMBER_REMOVED, {
      userId: 2,
      businessId: 1,
      phoneNumber: "+39123456789",
    });
  });

  it("propagates an emit failure instead of swallowing it", async () => {
    emitToWhatsapp.mockRejectedValue(new Error("redis down"));
    await expect(service.addNumber(1, 2, "+39123456789")).rejects.toThrow("redis down");
  });

  it("rejects a missing or non-E.164 phone number", () => {
    expect(() => whatsappNumberBodySchema.parse({})).toThrow(ZodError);
    expect(() => whatsappNumberBodySchema.parse({ phoneNumber: "12345" })).toThrow(ZodError);
  });
});

import { eventNames } from "@leadflow/shared/eventBus";
import { emitToWhatsapp } from "#comms/bullmq/bullmq.eventEmitter";
import { WhatsappNumberRepository } from "./whatsappNumber.repo.js";

export class WhatsappNumberService {
  constructor(private readonly repo: WhatsappNumberRepository) {}

  async addNumber(businessId: number, userId: number, phoneNumber: string): Promise<void> {
    await this.repo.insert({ businessId, userId, phoneNumber });
    await emitToWhatsapp(eventNames.WHATSAPP_NUMBER_ADDED, { userId, businessId, phoneNumber });
  }

  async removeNumber(businessId: number, userId: number, phoneNumber: string): Promise<void> {
    await this.repo.deleteByBusinessPhone(businessId, phoneNumber);
    await emitToWhatsapp(eventNames.WHATSAPP_NUMBER_REMOVED, { userId, businessId, phoneNumber });
  }
}

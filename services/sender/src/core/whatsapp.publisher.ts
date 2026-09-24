import { eventNames, getEventEmitter, serviceNames, type senderDeliverToWhatsappPayload } from "@leadflow/shared";

export interface WhatsappPublisher {
  publish(payload: senderDeliverToWhatsappPayload & { idempotencyKey: string }): Promise<void>;
}

/**
 * Hands a message to the whatsapp service. The idempotency key doubles as the
 * event's job id, so a replayed hand-off is dropped by the queue before the
 * whatsapp service even has to dedupe it.
 */
export const busWhatsappPublisher: WhatsappPublisher = {
  async publish(payload) {
    await getEventEmitter().emit(serviceNames.WHATSAPP, eventNames.WHATSAPP_REQUEST_CREATED, payload, {
      jobId: payload.idempotencyKey,
    });
  },
};

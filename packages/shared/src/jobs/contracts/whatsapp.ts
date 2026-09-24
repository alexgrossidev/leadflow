import { senderDeliverToWhatsappPayload } from "../../eventBus/event.contracts";

export interface WhatsappProcessPayload extends senderDeliverToWhatsappPayload {
  messageLogId: number;
  idempotencyKey: string;
}

export interface Attachment {
  type: 'image' | 'document' | 'audio';
  url?: string;
  base64?: string;
  filename?: string;
  mimeType?: string;
  ptt?: boolean;
}


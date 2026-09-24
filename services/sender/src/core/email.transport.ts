import nodemailer from "nodemailer";
import type { Env } from "#config/env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Sent as the Message-ID header so the same message is recognisable across retries. */
  messageId: string;
}

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

/** SMTP delivery (Mailpit in the demo). Credentials are optional for local relays. */
export function createSmtpTransport(
  env: Pick<Env, "SMTP_HOST" | "SMTP_PORT" | "SMTP_SECURE" | "SMTP_USER" | "SMTP_PASSWORD" | "SMTP_FROM">,
): EmailTransport & { close(): void } {
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" } } : {}),
  });

  return {
    async send(email) {
      try {
        await transporter.sendMail({
          from: env.SMTP_FROM,
          to: email.to,
          subject: email.subject,
          text: email.text,
          messageId: email.messageId,
        });
      } catch (err) {
        // SMTP replies often quote the recipient address; keep only the codes,
        // since this message ends up in logs and in sending_errors.
        const { code, responseCode } = (err ?? {}) as { code?: string; responseCode?: number };
        throw new Error(`SMTP delivery failed (code=${code ?? "unknown"}, response=${responseCode ?? "none"})`);
      }
    },
    close: () => transporter.close(),
  };
}

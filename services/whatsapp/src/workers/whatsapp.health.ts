import { logger } from "@leadflow/shared";
import type { WhatsappClient } from "#transport/whatsapp.client";

/**
 * Periodically probes the transport and logs state changes (healthy → down and
 * back). Per-session recovery is driven by disconnect webhooks, not by this loop.
 * Returns a function that stops the monitor.
 */
export function startTransportHealthMonitor(client: Pick<WhatsappClient, "healthCheck">, intervalMs: number): () => void {
  let lastHealthy = true;

  const check = async () => {
    const healthy = await client.healthCheck();
    if (healthy && !lastHealthy) logger.info("WhatsApp transport recovered");
    if (!healthy && lastHealthy) logger.warn("WhatsApp transport unreachable");
    lastHealthy = healthy;
  };

  const interval = setInterval(() => void check(), intervalMs);
  interval.unref();
  void check();

  return () => clearInterval(interval);
}

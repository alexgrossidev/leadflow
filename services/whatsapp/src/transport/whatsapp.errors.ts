export class RetriableWhatsappError extends Error {
  constructor(
    message: string,
    public readonly code = "WHATSAPP_TRANSIENT",
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "RetriableWhatsappError";
  }
}

export class UnrecoverableWhatsappError extends Error {
  constructor(
    message: string,
    public readonly code = "WHATSAPP_FATAL",
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "UnrecoverableWhatsappError";
  }
}

export function normalizeWhatsappError(error: unknown): {
  code?: string;
  message: string;
  payload?: unknown;
} {
  if (
    error instanceof RetriableWhatsappError ||
    error instanceof UnrecoverableWhatsappError
  ) {
    return {
      code: error.code,
      message: error.message,
      payload: error.payload,
    };
  }

  if (error instanceof Error) {
    return {
      code: error.name,
      message: error.message,
    };
  }

  return {
    code: "UNKNOWN",
    message: String(error),
    payload: error,
  };
}

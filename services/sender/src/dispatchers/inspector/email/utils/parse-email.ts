export interface ParsedEmail {
  localPart: string;
  domain: string;
}

export function parseEmail(email: string): ParsedEmail {
  const normalized = email.trim().toLowerCase();

  const parts = normalized.split("@");

  if (parts.length !== 2) {
    throw new Error("Invalid email structure");
  }

  const [localPart, domain] = parts;

  if (!localPart || !domain) {
    throw new Error("Invalid email structure");
  }

  return {
    localPart,
    domain,
  };
}

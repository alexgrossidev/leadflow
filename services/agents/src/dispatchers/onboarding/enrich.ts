import { logger } from "#core/logger";
import {
  BlockedUrlError,
  safeFetch,
  type Resolver,
  type Transport,
} from "#core/net/safe-fetch";

/**
 * Looks up a business's website to fill gaps the owner's text left open. This
 * is the only channel for extra information: onboarding runs unattended, so the
 * parser cannot ask the owner anything; whatever the text does not state must
 * be found here or reported as missing.
 *
 * A port, not a fixed implementation: a richer extractor (multi-page
 * navigation, a proper readability pass) can grow behind this interface
 * without the parser or orchestrator changing. Always best-effort: it returns
 * undefined rather than throwing, so enrichment can never block or fail a run.
 */
export interface WebsiteEnricher {
  enrich(url: string, signal?: AbortSignal): Promise<string | undefined>;
}

export interface EnricherOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** Injectable for tests; defaults to system DNS and node:http(s). */
  resolver?: Resolver;
  transport?: Transport;
}

/** Enrichment switched off. */
export class NoopWebsiteEnricher implements WebsiteEnricher {
  async enrich(): Promise<undefined> {
    return undefined;
  }
}

/**
 * Fetches the site's landing page through the SSRF guard and reduces it to
 * readable text. Bare-bones by design: one page, a crude tag strip.
 *
 * The URL comes from untrusted text, hence safeFetch; the page it returns is
 * untrusted too, and the parser treats it as data (see prompts.ts).
 */
export class HttpWebsiteEnricher implements WebsiteEnricher {
  constructor(private readonly options: EnricherOptions) {}

  async enrich(url: string, signal?: AbortSignal): Promise<string | undefined> {
    try {
      const response = await safeFetch(url, { ...this.options, signal });
      if (response.status < 200 || response.status >= 300 || !response.body) {
        return undefined;
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!/text\/html|text\/plain/i.test(contentType)) return undefined;

      const text = htmlToText(response.body.toString("utf8"));
      return text.length > 0 ? text : undefined;
    } catch (error) {
      if (error instanceof BlockedUrlError) {
        logger.warn({ reason: error.message }, "Website enrichment refused by SSRF guard");
      }
      return undefined;
    }
  }
}

/** First http(s) URL in free text, if any: the trigger for enrichment. */
export const extractUrl = (text: string): string | undefined =>
  text.match(/https?:\/\/[^\s<>"')]+/i)?.[0];

export const htmlToText = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

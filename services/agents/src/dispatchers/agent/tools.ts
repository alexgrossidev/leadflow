import { z } from "zod";
import { ToolRejection } from "#core/agent/agent.errors";
import type { AgentTool } from "#core/agent/tool";
import type { LeadflowClient } from "#core/axios/leadflow.client";
import type { AgentCapability } from "#modules/agent-config/agent-config.registry";
import { findForbiddenKeyword } from "./forbidden-keywords.js";

/**
 * Identity is bound here, from the trigger, never taken from model output: it
 * is spread last in every payload, so a model that names `businessId` or
 * `conversationId` in its arguments cannot redirect the call.
 */
export interface ReceptionistContext {
  businessId: string;
  userId: string;
  conversationId: string;
  /** The tenant's banned words. Empty disables the check. */
  forbiddenKeywords: readonly string[];
  /** The tenant's enabled capabilities; tools needing anything else are not offered. */
  capabilities: readonly AgentCapability[];
  /** See ATTACHMENT_URL_PREFIXES. Empty disables the attachment tool. */
  attachmentUrlPrefixes: readonly string[];
  client: LeadflowClient;
}

interface ReceptionistToolDefinition<Input extends Record<string, unknown>> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  endpoint: string;
  /** Capabilities the tenant must have enabled for the tool to be offered. */
  requires: readonly AgentCapability[];
  /** Fields the customer reads, checked against the tenant's banned words. */
  customerText: readonly (keyof Input & string)[];
  maxCallsPerRun: number;
  terminal?: boolean;
  /** Extra checks that need the run's context. Throw ToolRejection to refuse. */
  check?: (input: Input, context: ReceptionistContext) => void;
}

const respondWhatsapp: ReceptionistToolDefinition<{ message: string }> = {
  name: "respond_whatsapp",
  description:
    "Send your reply to the customer on WhatsApp. This is the only way your words reach them. Call it once, after any other actions: sending the reply ends your turn.",
  schema: z
    .object({
      message: z
        .string()
        .min(1)
        .max(4_000)
        .describe("The reply to the customer, in the customer's language."),
    })
    .strict(),
  endpoint: "/internal/agents/whatsapp/send",
  requires: ["whatsapp"],
  customerText: ["message"],
  // One reply per inbound message: together with `terminal`, a confused or
  // manipulated run cannot flood a customer.
  maxCallsPerRun: 1,
  terminal: true,
};

const sendAttachment: ReceptionistToolDefinition<{
  file_url: string;
  file_type: "pdf" | "image" | "video";
}> = {
  name: "send_whatsapp_attachment",
  description:
    "Send the customer a PDF, image or video from the business's file storage via WhatsApp. Only URLs of files the business provided are accepted.",
  schema: z
    .object({
      file_url: z.string().min(1).max(2_048).describe("HTTPS URL of the business's file."),
      file_type: z.enum(["pdf", "image", "video"]),
    })
    .strict(),
  endpoint: "/api/agents/files/send",
  requires: ["whatsapp", "files"],
  customerText: [],
  maxCallsPerRun: 3,
  check: (input, context) => {
    if (!isAllowedAttachmentUrl(input.file_url, context)) {
      throw new ToolRejection(
        "Not sent: file_url must be an HTTPS link to one of the business's own files. Use a link from the business information, or reply without an attachment.",
      );
    }
  },
};

const scheduleAppointment: ReceptionistToolDefinition<{ appointment_time: string }> = {
  name: "schedule_appointment",
  description:
    "Book an appointment in the CRM for the customer in this conversation, once they have agreed to a specific date and time.",
  schema: z
    .object({
      appointment_time: z.iso
        .datetime({ offset: true })
        .describe("ISO 8601 date and time, with offset, e.g. 2026-10-02T15:30:00+02:00."),
    })
    .strict(),
  endpoint: "/api/agents/calendar/appointments",
  requires: ["calendar"],
  customerText: [],
  maxCallsPerRun: 1,
};

/**
 * An attachment URL must be HTTPS, carry no credentials, and start with one of
 * the configured prefixes after `{businessId}` is substituted, so one tenant's
 * run cannot send another tenant's files, or an arbitrary link, to a customer.
 * Both sides go through the URL parser first, which resolves dot segments and
 * percent-encoded dots, so `/tenants/1/../2/` cannot escape the prefix.
 */
export const isAllowedAttachmentUrl = (
  raw: string,
  context: Pick<ReceptionistContext, "businessId" | "attachmentUrlPrefixes">,
): boolean => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  return context.attachmentUrlPrefixes.some((template) => {
    try {
      const prefix = new URL(
        template.replaceAll("{businessId}", encodeURIComponent(context.businessId)),
      ).href;
      return url.href.startsWith(prefix);
    } catch {
      return false;
    }
  });
};

const toAgentTool = <Input extends Record<string, unknown>>(
  definition: ReceptionistToolDefinition<Input>,
  context: ReceptionistContext,
): AgentTool<Input> => ({
  name: definition.name,
  description: definition.description,
  schema: definition.schema,
  // Every receptionist tool reaches the customer or the CRM.
  sideEffects: true,
  terminal: definition.terminal,
  maxCallsPerRun: definition.maxCallsPerRun,
  execute: async (input, signal) => {
    // The prompt asks the model to avoid these words; this is what makes it true.
    if (context.forbiddenKeywords.length > 0) {
      for (const field of definition.customerText) {
        const value = input[field];
        if (typeof value !== "string") continue;
        const hit = findForbiddenKeyword(value, context.forbiddenKeywords);
        if (hit) {
          throw new ToolRejection(
            `Not sent: your "${field}" contains "${hit}", which you may never use. Write it again without that word or any form of it.`,
          );
        }
      }
    }
    definition.check?.(input, context);

    await context.client.post(
      definition.endpoint,
      {
        ...input,
        businessId: context.businessId,
        userId: context.userId,
        conversationId: context.conversationId,
      },
      { signal },
    );
    return "Done.";
  },
});

/** A definition with its input type erased, so different tools can share one list. */
interface ToolFactory {
  name: string;
  requires: readonly AgentCapability[];
  build(context: ReceptionistContext): AgentTool;
}

const factory = <Input extends Record<string, unknown>>(
  definition: ReceptionistToolDefinition<Input>,
): ToolFactory => ({
  name: definition.name,
  requires: definition.requires,
  build: (context) => toAgentTool(definition, context),
});

const FACTORIES: readonly ToolFactory[] = [
  factory(respondWhatsapp),
  factory(sendAttachment),
  factory(scheduleAppointment),
];

/**
 * The tools a run may use: the tenant's enabled capabilities decide what is on
 * offer, so a tenant without the calendar capability never sees
 * schedule_appointment and a prompt injection cannot reach it.
 */
export const buildReceptionistTools = (context: ReceptionistContext): AgentTool[] =>
  FACTORIES.filter((tool) =>
    tool.requires.every((capability) => context.capabilities.includes(capability)),
  )
    // Without configured storage prefixes no attachment URL could pass the check.
    .filter(
      (tool) =>
        tool.name !== sendAttachment.name || context.attachmentUrlPrefixes.length > 0,
    )
    .map((tool) => tool.build(context));

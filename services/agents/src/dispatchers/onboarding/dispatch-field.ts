import type { LeadflowClient } from "#core/axios/leadflow.client";
import { InternalServerError } from "#core/errors/http-errors";
import type { DispatchKind, OnboardingField } from "./registry.js";
import type { OnboardingContext } from "./types.js";

/** What the gateway may hand back after creating a record. */
interface CreateResponse {
  id?: string | number;
  businessId?: string | number;
}

type Payload = Record<string, unknown>;

/** How one dispatch reaches the gateway: the client plus the field's deadline. */
export interface DispatchTransport {
  client: LeadflowClient;
  signal?: AbortSignal;
}

type DispatchHandler = (
  field: OnboardingField,
  payload: Payload,
  context: OnboardingContext,
  transport: DispatchTransport,
) => Promise<void>;

const post = (
  endpoint: string,
  body: Payload,
  transport: DispatchTransport,
): Promise<CreateResponse> =>
  transport.client.post<CreateResponse>(endpoint, body, {
    signal: transport.signal,
  });

/**
 * Identity is bound last in every call so a value the model happened to name
 * in its output can never redirect it (the same guard the receptionist tools
 * use). camelCase `userId`/`businessId`; endpoints using other names inject
 * their own (see parentChildren).
 */
const identity = (context: OnboardingContext): Payload => ({
  userId: context.userId,
  ...(context.businessId ? { businessId: context.businessId } : {}),
});

const requireEndpoint = (field: OnboardingField): string => {
  if (!field.endpoint) {
    throw new InternalServerError(
      `Field "${field.key}" has no endpoint`,
      "ONBOARDING_MISCONFIGURED",
    );
  }
  return field.endpoint;
};

const newId = (response: CreateResponse): string | number | undefined =>
  response?.id ?? response?.businessId;

/** One POST. Threads the created business id when this is the field that makes it. */
const single: DispatchHandler = async (field, payload, context, transport) => {
  const response = await post(
    requireEndpoint(field),
    { ...field.defaults, ...payload, ...identity(context) },
    transport,
  );
  if (field.providesBusinessId && !context.businessId) {
    const id = newId(response);
    if (id !== undefined && id !== null) context.businessId = String(id);
  }
};

/**
 * Create a parent, then a child per item, threading the parent's id. The parent
 * carries the business id under its own field name (`parentBusinessField`); the
 * children are sent one by one so a partial failure is attributable.
 */
const parentChildren: DispatchHandler = async (field, payload, context, transport) => {
  const childrenKey = field.childrenKey ?? "children";
  const { [childrenKey]: rawChildren, ...parent } = payload;
  const children = Array.isArray(rawChildren) ? (rawChildren as Payload[]) : [];

  const parentBody: Payload = { ...field.defaults, ...parent };
  if (field.parentBusinessField && context.businessId) {
    parentBody[field.parentBusinessField] = context.businessId;
  }

  const response = await post(requireEndpoint(field), parentBody, transport);
  const parentId = newId(response);
  if (parentId === undefined || parentId === null) {
    throw new InternalServerError(
      `Field "${field.key}" parent create returned no id`,
      "ONBOARDING_NO_PARENT_ID",
    );
  }

  if (!field.childEndpoint || !field.parentIdField) {
    throw new InternalServerError(
      `Field "${field.key}" is missing child dispatch config`,
      "ONBOARDING_MISCONFIGURED",
    );
  }

  for (const child of children) {
    await post(
      field.childEndpoint,
      { ...child, [field.parentIdField]: parentId },
      transport,
    );
  }
};

/** Pick the endpoint from `routes` by the discriminator, which is not sent on. */
const routed: DispatchHandler = async (field, payload, context, transport) => {
  const routeBy = field.routeBy;
  if (!routeBy || !field.routes) {
    throw new InternalServerError(
      `Field "${field.key}" is missing routing config`,
      "ONBOARDING_MISCONFIGURED",
    );
  }

  const { [routeBy]: discriminator, ...body } = payload;
  const endpoint = field.routes[String(discriminator)];
  if (!endpoint) {
    throw new InternalServerError(
      `Field "${field.key}" has no route for ${routeBy}="${String(discriminator)}"`,
      "ONBOARDING_UNROUTED",
    );
  }

  await post(
    endpoint,
    { ...field.defaults, ...body, ...identity(context) },
    transport,
  );
};

const HANDLERS: Record<DispatchKind, DispatchHandler> = {
  single,
  parentChildren,
  routed,
};

/**
 * Sends one parsed record to the gateway using the field's dispatch shape.
 * Defaults to a single POST; parentChildren and routed cover multi-call and
 * conditional-endpoint fields without the orchestrator knowing the difference.
 */
export const dispatchField = (
  field: OnboardingField,
  payload: Payload,
  context: OnboardingContext,
  transport: DispatchTransport,
): Promise<void> =>
  HANDLERS[field.dispatch ?? "single"](field, payload, context, transport);

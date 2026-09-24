import type { ToolSpec } from "#core/agent/llm.port";
import rawRegistry from "./fields.json";

/**
 * How a field's parsed record becomes gateway calls. Adding a shape means
 * adding a handler (see dispatch-field.ts) and a value here - fields opt in from
 * the registry, the engine stays generic.
 *   - single         one POST to `endpoint` (default).
 *   - parentChildren  create a parent, then a child per item, threading the
 *                     parent id. Needs `childEndpoint`, `childrenKey`,
 *                     `parentIdField`, optionally `parentBusinessField`.
 *   - routed         pick `endpoint` from `routes` by the value of `routeBy` in
 *                     the payload (which is stripped before sending).
 */
export type DispatchKind = "single" | "parentChildren" | "routed";

/**
 * One thing onboarding knows how to parse and create. The registry
 * (fields.json) is the whole contract: to onboard something new, add an entry
 * there; the parser, dispatcher and orchestrator are field-agnostic.
 */
export interface OnboardingField {
  /** Matches a key in the submission's `inputs`. */
  key: string;
  /** Primary gateway endpoint. Unused by `routed` (see `routes`). */
  endpoint?: string;
  /** Dispatch shape; defaults to `single`. */
  dispatch?: DispatchKind;
  /** Marks the field whose response yields the new businessId later fields need. */
  providesBusinessId?: boolean;
  /** Whether a website in the text should be looked up to enrich the parse. */
  enrich?: boolean;
  /**
   * Server-side constants merged into the payload the model never sees or sets
   * (e.g. a fixed record name). Cannot override model output or bound identity.
   */
  defaults?: Record<string, unknown>;

  // ── parentChildren ──────────────────────────────────────────────────────
  /** Endpoint each child is POSTed to. */
  childEndpoint?: string;
  /** Payload key holding the array of children. */
  childrenKey?: string;
  /** Field name on each child that carries the created parent's id. */
  parentIdField?: string;
  /** Field name on the parent that carries the business id, if it needs one. */
  parentBusinessField?: string;

  // ── routed ──────────────────────────────────────────────────────────────
  /** Payload property whose value selects the endpoint. */
  routeBy?: string;
  /** Map of that value to endpoint. */
  routes?: Record<string, string>;

  /** Field-specific guidance handed to the model on top of the base persona. */
  instructions: string;
  /** JSON Schema of the target record; submitted records are validated against it. */
  payload: ToolSpec["inputSchema"];
}

// JSON string/object literals widen to string/Record, so the file is typed once
// here rather than asserting each field individually.
const FIELDS: readonly OnboardingField[] = (
  rawRegistry as unknown as { fields: OnboardingField[] }
).fields;

const byKey = new Map(FIELDS.map((field) => [field.key, field]));

export const getField = (key: string): OnboardingField | undefined =>
  byKey.get(key);

/**
 * The registered fields present in a submission, in registry order. Order is the
 * dependency order: business_info comes first so its businessId is available to
 * everything after it.
 */
export const orderedFields = (
  inputs: Record<string, string>,
): OnboardingField[] => FIELDS.filter((field) => field.key in inputs);

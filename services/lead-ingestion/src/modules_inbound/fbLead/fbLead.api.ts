import { facebookClient } from "#core/http/facebook.client";

/** A single lead as returned by `GET /{leadgen-id}`. */
export interface GraphLead {
  id: string;
  created_time?: string;
  field_data?: { name: string; values: string[] }[];
}

interface GraphPage<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** Upper bound on pages walked per call, so a paging loop can never run away. */
const MAX_PAGES = 50;

/** Fetch one lead's answers. Failures surface as a redacted ExternalHttpError. */
export function getLeadDetailsAPI(
  leadId: string,
  token: string,
): Promise<GraphLead | null | undefined> {
  return facebookClient.get<GraphLead>(`/${leadId}`, {
    params: { access_token: token },
  });
}

/** Follow Graph cursor pagination until the last page (bounded by MAX_PAGES). */
async function collectPages<T>(
  path: string,
  params: Record<string, unknown>,
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await facebookClient.get<GraphPage<T>>(path, {
      params: { ...params, limit: 100, ...(after ? { after } : {}) },
    });
    items.push(...(res?.data ?? []));
    after = res?.paging?.cursors?.after;
    if (!res?.paging?.next || !after) break;
  }
  return items;
}

/** Ids of every lead form on a page. */
export function getLeadFormIdsAPI(
  pageId: string,
  token: string,
): Promise<{ id: string }[]> {
  return collectPages<{ id: string }>(`/${pageId}/leadgen_forms`, {
    access_token: token,
    fields: "id",
  });
}

/** Ids of a form's leads created after `sinceUnix` (seconds). */
export function getFormLeadIdsSinceAPI(
  formId: string,
  token: string,
  sinceUnix: number,
): Promise<{ id: string }[]> {
  return collectPages<{ id: string }>(`/${formId}/leads`, {
    access_token: token,
    fields: "id",
    filtering: JSON.stringify([
      { field: "time_created", operator: "GREATER_THAN", value: sinceUnix },
    ]),
  });
}

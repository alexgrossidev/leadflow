export interface FacebookLeadProcessPayload {
  leadgenId: string;
  pageId: string;
  formId?: string;
  createdTime?: number;
}

export interface FacebookExchangeTokenPayload {
  accessToken: string;
  createdTime: number;
  userId: number;
  businessId: number;
}

export interface FacebookCheckSubscriptionPayload {
  userId: number;
  businessId: number;
  retryCount: number;
}

export interface FacebookPeriodicSyncPayload {
  userId: number;
  pageId: string;
}

/** Heal/refresh a stored page token (extend → re-mint → validate → resubscribe). */
export interface FacebookRefreshTokenPayload {
  userId: number;
  businessId: number;
  pageId?: string;
}

/**
 * Emitted when a user's Facebook token is unrecoverable (refresh + heal failed).
 * Consumed by main to notify the user that they must reconnect their account.
 */
export interface FacebookTokenRevokedPayload {
  userId: number;
  businessId: number;
  pageId?: string;
  reason: string;
}

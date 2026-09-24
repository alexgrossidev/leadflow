-- Accounts whose Facebook token could not be exchanged, refreshed or healed.
-- One row per (user_id, business_id); a repeat failure bumps `attempts` and
-- clears `resolved_at`. `notified_at` is stamped once FACEBOOK_TOKEN_REVOKED
-- was emitted. Kept as an audit trail, never deleted on resolution.
CREATE TABLE facebook_token_failure (
    id          INT          NOT NULL AUTO_INCREMENT,
    user_id     INT          NOT NULL,
    business_id INT          NOT NULL,
    page_id     VARCHAR(32)  NULL,
    reason      VARCHAR(128) NOT NULL,
    attempts    INT          NOT NULL DEFAULT 1,
    last_error  TEXT         NULL,
    notified_at TIMESTAMP    NULL,
    resolved_at TIMESTAMP    NULL,
    created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_token_failure_user_business (user_id, business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

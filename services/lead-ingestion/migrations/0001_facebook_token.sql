-- One connected Facebook account per (user, business). The row is also the
-- persisted progress of the token-exchange state machine (token_type "user" ->
-- "page", then valid / fb_page_id / subscribed). oauth_code_hash is the SHA-256
-- of the OAuth code the row was exchanged from: a retry of the same code
-- resumes, a new code re-exchanges.
CREATE TABLE facebook_token (
    id              INT          NOT NULL AUTO_INCREMENT,
    user_id         INT          NOT NULL,
    business_id     INT          NOT NULL,
    fb_page_id      VARCHAR(32)  NULL,
    token           TEXT         NOT NULL,
    token_type      VARCHAR(50)  NOT NULL,
    subscribed      TINYINT(1)   NOT NULL,
    valid           TINYINT(1)   NOT NULL DEFAULT 0,
    expires_at      TIMESTAMP    NOT NULL,
    refresh_token   TEXT         NULL,
    oauth_code_hash CHAR(64)     NULL,
    last_synced_at  TIMESTAMP    NULL,
    created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_facebook_token_user_business (user_id, business_id),
    KEY idx_fb_page_id (fb_page_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

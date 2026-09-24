-- Progress of one Facebook lead through FETCH -> PARSE -> DELIVER, so a retried
-- job resumes from the last completed stage.
CREATE TABLE facebook_lead (
    id             INT          NOT NULL AUTO_INCREMENT,
    user_id        INT          NOT NULL,
    lead_id        VARCHAR(64)  NOT NULL,
    fetched        TINYINT(1)   NOT NULL DEFAULT 0,
    delivered      TINYINT(1)   NOT NULL DEFAULT 0,
    raw_response   JSON         NOT NULL,
    clean_response JSON         NOT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_user_lead (user_id, lead_id),
    -- Serves the reconciliation query for undelivered leads.
    KEY idx_user_delivered (user_id, delivered)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

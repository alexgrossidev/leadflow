-- Delivery guard, shared by the Facebook and Google flows. A worker CLAIMS
-- (user_id, lead_id) before calling the gateway, marks DELIVERED on success and
-- releases on failure. A stale IN_FLIGHT claim (crash mid-delivery) can be
-- reclaimed, so a lead is never stranded. The gateway intake is itself
-- idempotent; this is defense in depth that also skips the call on redrives.
CREATE TABLE lead_delivery (
    id                INT          NOT NULL AUTO_INCREMENT,
    user_id           INT          NOT NULL,
    lead_id           VARCHAR(64)  NOT NULL,
    status            ENUM('IN_FLIGHT', 'DELIVERED') NOT NULL DEFAULT 'IN_FLIGHT',
    attempts          INT          NOT NULL DEFAULT 0,
    delivery_response JSON         NULL,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_lead_delivery (user_id, lead_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

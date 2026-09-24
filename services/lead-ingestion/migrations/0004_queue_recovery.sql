-- Dead-letter store for lead jobs that exhausted their in-queue retries. One
-- row per (queue_name, dedupe_key): a lead that fails again after a re-drive
-- re-opens its row with a higher retry_count, so the backoff keeps growing.
CREATE TABLE queue_recovery (
    id            INT          NOT NULL AUTO_INCREMENT,
    queue_name    VARCHAR(128) NOT NULL,
    dedupe_key    VARCHAR(128) NOT NULL,
    payload       JSON         NOT NULL,
    error_code    VARCHAR(50)  NULL,
    error_type    ENUM('TRANSIENT', 'FATAL') NOT NULL,
    status        ENUM('PENDING_RECOVERY', 'RECOVERING', 'FAILED_PERMANENTLY', 'RESOLVED')
                  NOT NULL DEFAULT 'PENDING_RECOVERY',
    retry_count   INT          NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP    NULL,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_queue_recovery_key (queue_name, dedupe_key),
    KEY idx_status_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

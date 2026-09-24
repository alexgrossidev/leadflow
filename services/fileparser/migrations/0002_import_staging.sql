-- Parsed file rows waiting to be delivered to the gateway.
CREATE TABLE `import_staging` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `business_id` INT NOT NULL,
    `import_job_id` CHAR(36) NOT NULL,
    `raw_data` JSON NOT NULL,
    -- RAW until the gateway acknowledges the batch, then DELIVERED.
    `status` VARCHAR(16) NOT NULL DEFAULT 'RAW',
    -- sha256 of the row; identical rows in one file are staged once.
    `data_hash` BINARY(32) NOT NULL,
    `delivered_at` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uidx_job_payload` (`import_job_id`, `data_hash`),
    -- Keyset scan: WHERE import_job_id = ? AND status = 'RAW' AND id > ? ORDER BY id.
    KEY `idx_staging_job_status_id` (`import_job_id`, `status`, `id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

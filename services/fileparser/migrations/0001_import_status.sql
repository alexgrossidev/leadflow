-- One row per import job: its lifecycle and why it failed, if it did.
CREATE TABLE `import_status` (
    `import_job_id` CHAR(36) NOT NULL,
    `status` ENUM('pending', 'progress', 'complete', 'processed', 'fail') NOT NULL,
    -- Times delivery was postponed because staging had not finished; capped in code.
    `reschedule_count` INT NOT NULL DEFAULT 0,
    `fail_reason` VARCHAR(512) DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`import_job_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

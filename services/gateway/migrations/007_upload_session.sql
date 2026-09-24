-- One row per bulk import; the fileparser reports progress back onto it.

CREATE TABLE upload_session (
  id             INT NOT NULL AUTO_INCREMENT,
  user_id        INT NOT NULL,
  business_id    INT NOT NULL,
  type           ENUM('lead', 'customer') NOT NULL DEFAULT 'customer',
  storage_key    VARCHAR(255) NOT NULL,
  filename       VARCHAR(255) DEFAULT NULL,
  import_job_id  CHAR(36) NOT NULL,
  status         ENUM('uploaded', 'processing', 'completed', 'failed') DEFAULT NULL,
  total_rows     INT DEFAULT 0,
  processed_rows INT DEFAULT 0,
  failed_rows    INT DEFAULT 0,
  started_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  created_at     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at   TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_upload_job (import_job_id),
  KEY idx_upload_business (business_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

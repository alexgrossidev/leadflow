-- Customers with an entity-attribute-value model for per-business custom
-- fields, plus the staging log and dead-letter table used by bulk imports.

CREATE TABLE customers_v2 (
  id          INT NOT NULL AUTO_INCREMENT,
  business_id INT NOT NULL,
  user_id     INT NOT NULL,
  name        VARCHAR(255) DEFAULT NULL,
  email       VARCHAR(255) DEFAULT NULL,  -- NULL when unknown; the unique key ignores NULLs
  phone       VARCHAR(100) DEFAULT NULL,
  created     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_email (business_id, email),
  KEY idx_business_active (business_id, deleted_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers_v2_staging (
  id                INT NOT NULL AUTO_INCREMENT,
  business_id       INT NOT NULL,
  user_id           INT NOT NULL,
  name              VARCHAR(255) DEFAULT NULL,
  email             VARCHAR(255) DEFAULT NULL,
  phone             VARCHAR(100) DEFAULT NULL,
  import_source_key VARCHAR(255) DEFAULT NULL,
  data_hash         CHAR(64) NOT NULL,        -- SHA-256 hex of the normalised row
  status            ENUM('pending', 'processed', 'duplicate', 'failed') DEFAULT 'pending',
  created           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_stage_dedupe (business_id, data_hash),
  KEY idx_stage_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers_v2_customfields (
  id          INT NOT NULL AUTO_INCREMENT,
  business_id INT NOT NULL,
  user_id     INT NOT NULL,
  field       VARCHAR(255) NOT NULL,
  deleted_at  TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cf_business_field (business_id, field),
  KEY idx_cf_business_deleted (business_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers_v2_customvalues (
  id                INT NOT NULL AUTO_INCREMENT,
  business_id       INT NOT NULL,
  user_id           INT NOT NULL,
  customer_id       INT NOT NULL,
  customfield_id    INT NOT NULL,
  customfield_value TEXT DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cust_field (customer_id, customfield_id),
  KEY idx_cv_business (business_id),
  CONSTRAINT fk_cv_customer FOREIGN KEY (customer_id) REFERENCES customers_v2 (id) ON DELETE CASCADE,
  CONSTRAINT fk_cv_field FOREIGN KEY (customfield_id) REFERENCES customers_v2_customfields (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customers_v2_failed_imports (
  id                INT NOT NULL AUTO_INCREMENT,
  business_id       INT NOT NULL,
  user_id           INT NOT NULL,
  import_job_id     VARCHAR(255) NOT NULL,
  import_source_key VARCHAR(255) NOT NULL,
  customer_name     VARCHAR(255) DEFAULT NULL,
  customer_email    VARCHAR(255) DEFAULT NULL,
  customer_phone    VARCHAR(100) DEFAULT NULL,
  field_slug        VARCHAR(255) DEFAULT NULL,
  field_value       TEXT DEFAULT NULL,
  row_hash          VARCHAR(64) DEFAULT NULL,
  failure_reason    VARCHAR(255) NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fail_job (import_job_id),
  KEY idx_fail_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

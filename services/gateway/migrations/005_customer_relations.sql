-- Notes, documents and service assignments attached to a customer. Every
-- table carries business_id so each query is scoped to the tenant directly.

CREATE TABLE customer_notes_v2 (
  id              INT NOT NULL AUTO_INCREMENT,
  customer_id     INT NOT NULL,
  business_id     INT NOT NULL,
  title           VARCHAR(255) NOT NULL,
  description     TEXT NOT NULL,
  created_by      INT NOT NULL,
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL,
  idempotency_key VARCHAR(128) DEFAULT NULL,
  deleted_at      DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notes_business_idempotency (business_id, idempotency_key),
  KEY idx_notes_customer_active (customer_id, deleted_at),
  CONSTRAINT fk_customer_notes_customer_id FOREIGN KEY (customer_id) REFERENCES customers_v2 (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_documents_v2 (
  id                 INT NOT NULL AUTO_INCREMENT,
  business_id        INT NOT NULL,
  customer_id        INT NOT NULL,
  file_name          VARCHAR(255) NOT NULL,
  file_path          VARCHAR(1024) NOT NULL,
  file_type          VARCHAR(255) NOT NULL,
  file_size_in_bytes INT NOT NULL,
  note               TEXT DEFAULT NULL,
  idempotency_key    VARCHAR(128) DEFAULT NULL,
  uploaded_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_docs_business_idempotency (business_id, idempotency_key),
  KEY idx_docs_business_customer (business_id, customer_id, deleted_at),
  CONSTRAINT fk_customer_documents_customer_id FOREIGN KEY (customer_id) REFERENCES customers_v2 (id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE customer_assigned_services_v2 (
  id                   INT NOT NULL AUTO_INCREMENT,
  business_id          INT NOT NULL,
  customer_id          INT NOT NULL,
  customer_services_id INT NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assigned_business_customer_service (business_id, customer_id, customer_services_id),
  KEY idx_assigned_customer (customer_id),
  CONSTRAINT fk_assigned_services_customer_id FOREIGN KEY (customer_id) REFERENCES customers_v2 (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

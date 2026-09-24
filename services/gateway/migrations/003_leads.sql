-- Leads. (businessId, lead_source, external_id) makes intake from
-- lead-ingestion idempotent; manual leads have a NULL external_id, which the
-- unique key ignores. Form answers live in custom_fields (JSON, keyed by slug).

CREATE TABLE leads (
  id               INT NOT NULL AUTO_INCREMENT,
  businessId       INT NOT NULL,
  user_id          INT NOT NULL,
  name             VARCHAR(255) DEFAULT NULL,
  company          VARCHAR(255) DEFAULT NULL,
  address          TEXT DEFAULT NULL,
  city             TEXT DEFAULT NULL,
  postcode         TEXT DEFAULT NULL,
  email            VARCHAR(255) DEFAULT NULL,
  phone            VARCHAR(50) DEFAULT NULL,
  status           VARCHAR(100) DEFAULT NULL,
  status_color     VARCHAR(50) DEFAULT NULL,
  last_contact     TIMESTAMP NULL DEFAULT NULL,
  value            VARCHAR(100) DEFAULT NULL,
  notes            TEXT DEFAULT NULL,
  archived         TINYINT DEFAULT 0,
  category         VARCHAR(255) DEFAULT NULL,
  duedate          TIMESTAMP NULL DEFAULT NULL,
  probability      INT DEFAULT NULL,
  lead_source      VARCHAR(32) NOT NULL DEFAULT 'manual',
  external_id      VARCHAR(255) DEFAULT NULL,
  custom_fields    JSON DEFAULT NULL,
  event_emitted_at TIMESTAMP NULL DEFAULT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_leads_business_source_external (businessId, lead_source, external_id),
  KEY idx_leads_business_id (businessId, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

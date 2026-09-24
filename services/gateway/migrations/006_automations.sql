-- Automation rules and their message steps.

CREATE TABLE automation_rules (
  id          INT NOT NULL AUTO_INCREMENT,
  user_id     INT NOT NULL,
  business_id INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  type        ENUM('customer', 'lead') DEFAULT NULL,
  paused      BOOLEAN NOT NULL DEFAULT FALSE,
  field       VARCHAR(255) DEFAULT NULL,
  operator    ENUM('eq', 'neq', 'contains', 'gt', 'lt', 'is_set', 'is_not_set') DEFAULT NULL,
  value       TEXT DEFAULT NULL,
  created_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_automation_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE automation_rules_steps (
  id            INT NOT NULL AUTO_INCREMENT,
  automation_id INT NOT NULL,
  title         VARCHAR(255) DEFAULT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  type          ENUM('email', 'whatsapp') DEFAULT NULL,
  email_subject VARCHAR(255) DEFAULT NULL,
  content       TEXT DEFAULT NULL,
  attachments   TEXT DEFAULT NULL,
  delay         INT DEFAULT NULL,
  delay_unit    VARCHAR(255) DEFAULT NULL,
  step_sequence INT DEFAULT NULL,
  created_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_steps_automation (automation_id),
  CONSTRAINT fk_steps_automation FOREIGN KEY (automation_id) REFERENCES automation_rules (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

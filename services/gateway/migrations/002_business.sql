-- Businesses (tenants) and the per-business tables that hang off them.

CREATE TABLE business (
  id                  INT NOT NULL AUTO_INCREMENT,
  userId              INT NOT NULL,
  name                VARCHAR(255) DEFAULT NULL,
  category            VARCHAR(100) NOT NULL,
  subcategory         VARCHAR(255) DEFAULT NULL,
  ragioneSociale      TEXT NOT NULL,          -- registered legal name
  phoneNumberPrefix   VARCHAR(10) NOT NULL,
  phoneNumber         TEXT NOT NULL,
  email               TEXT DEFAULT NULL,
  address             VARCHAR(255) NOT NULL,
  postalCode          TEXT NOT NULL,
  city                TEXT NOT NULL,
  province            TEXT NOT NULL,
  country             TEXT NOT NULL,
  latitude            DECIMAL(10, 8) DEFAULT NULL,
  longitude           DECIMAL(11, 8) DEFAULT NULL,
  websiteUrl          VARCHAR(255) DEFAULT NULL,
  logoUrl             VARCHAR(255) DEFAULT NULL,
  coverUrl            VARCHAR(255) DEFAULT NULL,
  about               TEXT NOT NULL,
  ownerFirstName      VARCHAR(100) DEFAULT NULL,
  ownerLastName       VARCHAR(100) DEFAULT NULL,
  businessTagLine     VARCHAR(255) DEFAULT NULL,
  yearOfIncorporation INT DEFAULT NULL,
  facebookUrl         VARCHAR(255) DEFAULT NULL,
  instagramUrl        VARCHAR(255) DEFAULT NULL,
  linkedinUrl         VARCHAR(255) DEFAULT NULL,
  twitterUrl          VARCHAR(255) DEFAULT NULL,
  whatsapp_accounts   INT NOT NULL DEFAULT 1,
  isfranchise         TINYINT NOT NULL DEFAULT 0,
  locationhidden      TINYINT NOT NULL DEFAULT 0,
  fiscalCode          VARCHAR(255) DEFAULT NULL,  -- personal tax code
  VATnumber           VARCHAR(255) DEFAULT NULL,
  sdi                 TEXT DEFAULT NULL,          -- e-invoicing recipient code
  pec                 TEXT DEFAULT NULL,          -- certified e-mail address
  created_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_business_user (userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE onboarding (
  id        INT NOT NULL AUTO_INCREMENT,
  user_id   INT NOT NULL,
  temp_id   INT DEFAULT NULL,
  completed BOOLEAN DEFAULT FALSE,
  data      JSON DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_onboarding_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE services (
  id               INT NOT NULL AUTO_INCREMENT,
  business_id      INT NOT NULL,
  service_category VARCHAR(255) DEFAULT NULL,
  sort_order       INT DEFAULT NULL,
  name             VARCHAR(255) DEFAULT NULL,
  description      TEXT DEFAULT NULL,
  price            DECIMAL(10, 2) DEFAULT NULL,
  duration         INT DEFAULT NULL,
  duration_unit    VARCHAR(50) DEFAULT NULL,
  is_popular       BOOLEAN DEFAULT FALSE,
  photo_url        TEXT DEFAULT NULL,
  active           BOOLEAN DEFAULT TRUE,
  PRIMARY KEY (id),
  KEY idx_services_business (business_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE whatsapp_numbers (
  id           INT NOT NULL AUTO_INCREMENT,
  business_id  INT NOT NULL,
  user_id      INT NOT NULL,
  phone_number VARCHAR(30) NOT NULL,
  session_id   VARCHAR(255) DEFAULT NULL,
  created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_business_phone (business_id, phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
  id          INT NOT NULL AUTO_INCREMENT,
  business_id INT NOT NULL,
  user_id     INT NOT NULL,
  action      VARCHAR(100) NOT NULL,
  ip_address  VARCHAR(45) DEFAULT NULL,
  user_agent  VARCHAR(512) DEFAULT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_business_created (business_id, created_at),
  KEY idx_audit_user (user_id),
  CONSTRAINT fk_audit_logs_business FOREIGN KEY (business_id) REFERENCES business (id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

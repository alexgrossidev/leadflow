-- Accounts and refresh-token sessions.

CREATE TABLE users (
  id            INT NOT NULL AUTO_INCREMENT,
  username      VARCHAR(100) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) DEFAULT NULL,
  company       VARCHAR(255) DEFAULT NULL,
  phone         VARCHAR(50)  DEFAULT NULL,
  password_hash VARCHAR(255) DEFAULT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Opaque refresh tokens, stored as SHA-256 digests. A rotation revokes the
-- presented row and inserts its successor in the same family.
CREATE TABLE refresh_tokens (
  id          INT NOT NULL AUTO_INCREMENT,
  user_id     INT NOT NULL,
  family_id   CHAR(36) NOT NULL,
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  revoked_at  DATETIME DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_token_hash (token_hash),
  KEY idx_refresh_family (family_id),
  KEY idx_refresh_user (user_id),
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

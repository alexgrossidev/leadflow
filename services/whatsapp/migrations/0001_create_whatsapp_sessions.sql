-- One row per (business, user) WhatsApp session; mirrors src/modules/sessions/session.table.ts.
CREATE TABLE whatsapp_sessions (
  id              INT NOT NULL AUTO_INCREMENT,
  business_id     INT NOT NULL,
  user_id         INT NOT NULL,
  status          ENUM('connecting','qr_ready','qr_scanned','connected','disconnected','failed','closed')
                  NOT NULL DEFAULT 'connecting',
  qr_code         TEXT NULL,
  qr_expires_at   TIMESTAMP NULL,
  connected_at    TIMESTAMP NULL,
  disconnected_at TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY whatsapp_sessions_business_user_uq (business_id, user_id),
  KEY whatsapp_sessions_status_idx (status)
);

-- Demo data for local runs. Login: username "demo" (or demo@leadflow.example),
-- password "demo-password". Not for production use.

INSERT INTO users (id, username, email, name, company, password_hash)
VALUES (1, 'demo', 'demo@leadflow.example', 'Demo User', 'Demo Studio',
        '$2b$10$FU08nExaRyegZ1xusE82Me6/cgb9LXUPeax4nVg5F2qv2lJVeXc5C');

INSERT INTO business (id, userId, name, category, ragioneSociale, phoneNumberPrefix, phoneNumber,
                      email, address, postalCode, city, province, country, about)
VALUES (1, 1, 'Demo Studio', 'beauty', 'Demo Studio Ltd', '+44', '2070000000',
        'hello@leadflow.example', '1 Example Street', 'EC1A 1AA', 'London', 'Greater London', 'GB',
        'A demo business for the leadflow walkthrough.');

INSERT INTO services (business_id, name, description, price, duration, duration_unit)
VALUES (1, 'Consultation', 'First meeting with a new client', 0.00, 30, 'minutes'),
       (1, 'Full treatment', 'Standard 60 minute session', 80.00, 60, 'minutes');

INSERT INTO leads (businessId, user_id, name, email, phone, status, lead_source, external_id, custom_fields)
VALUES
  (1, 1, 'Alice Martin', 'alice@leadflow.example', '+447700900001', 'new', 'facebook', 'fb-demo-0001',
   JSON_OBJECT('budget', '1500', 'service_interest', 'full treatment', 'preferred_contact', 'whatsapp')),
  (1, 1, 'Bruno Rossi', 'bruno@leadflow.example', '+447700900002', 'contacted', 'facebook', 'fb-demo-0002',
   JSON_OBJECT('budget', '300', 'service_interest', 'consultation', 'preferred_contact', 'email')),
  (1, 1, 'Chloe Dubois', 'chloe@leadflow.example', NULL, 'new', 'google_forms', 'gf-demo-0001',
   JSON_OBJECT('budget', '800', 'service_interest', 'full treatment')),
  (1, 1, 'Daniel Okafor', NULL, '+447700900004', 'qualified', 'manual', NULL,
   JSON_OBJECT('referral', 'walk-in'));

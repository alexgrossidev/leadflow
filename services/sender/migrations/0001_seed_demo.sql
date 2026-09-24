-- Demo data for business 1. Not part of drizzle's journal: it is applied by
-- the demo's init step after the schema, and is safe to re-run.

-- Generous limits and a short gap so the demo delivers within seconds.
-- Opening hours are stored below but not enforced (validate_for_business_hours = false),
-- so the demo works at any time of day; set it to true to see messages held
-- until the next opening.
INSERT INTO `settings`
  (`business_id`, `validate_for_business_hours`, `in_warm_up_mode`, `max_emails`, `max_whatsapps`,
   `tolerance_rate`, `minimum_wait_between_messages`, `timezone`)
VALUES (1, false, false, 1000, 1000, 0, 5, 'Europe/Rome')
ON DUPLICATE KEY UPDATE `business_id` = `business_id`;

-- Monday to Friday 09:00-13:00 and 14:00-18:00, closed at weekends.
INSERT INTO `opening_times`
  (`business_id`, `day`, `morning_open`, `morning_close`, `afternoon_open`, `afternoon_close`,
   `is_continuous`, `is_open`)
VALUES
  (1, 'mon', '09:00', '13:00', '14:00', '18:00', false, true),
  (1, 'tue', '09:00', '13:00', '14:00', '18:00', false, true),
  (1, 'wed', '09:00', '13:00', '14:00', '18:00', false, true),
  (1, 'thu', '09:00', '13:00', '14:00', '18:00', false, true),
  (1, 'fri', '09:00', '13:00', '14:00', '18:00', false, true),
  (1, 'sat', NULL, NULL, NULL, NULL, false, false),
  (1, 'sun', NULL, NULL, NULL, NULL, false, false)
ON DUPLICATE KEY UPDATE `business_id` = `business_id`;

INSERT INTO `multiseat_config` (`business_id`, `enabled`)
VALUES (1, false)
ON DUPLICATE KEY UPDATE `business_id` = `business_id`;

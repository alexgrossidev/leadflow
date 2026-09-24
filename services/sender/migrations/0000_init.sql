CREATE TABLE `sent_messages` (
	`message_key` varchar(191) NOT NULL,
	`automation_id` int NOT NULL,
	`recipient_type` enum('lead','customer') NOT NULL,
	`recipient_id` int NOT NULL,
	`user_id` int NOT NULL,
	`business_id` int NOT NULL,
	`channel` enum('email','whatsapp') NOT NULL,
	`sent_at` timestamp NOT NULL,
	CONSTRAINT `sent_messages_message_key` PRIMARY KEY(`message_key`)
);

CREATE TABLE `multiseat_config` (
	`business_id` int NOT NULL,
	`enabled` boolean NOT NULL,
	CONSTRAINT `multiseat_config_business_id` PRIMARY KEY(`business_id`)
);

CREATE TABLE `opening_times` (
	`id` int AUTO_INCREMENT NOT NULL,
	`business_id` int NOT NULL,
	`day` enum('mon','tue','wed','thu','fri','sat','sun') NOT NULL,
	`morning_open` varchar(8),
	`morning_close` varchar(8),
	`afternoon_open` varchar(8),
	`afternoon_close` varchar(8),
	`is_continuous` boolean NOT NULL DEFAULT false,
	`is_open` boolean NOT NULL DEFAULT false,
	CONSTRAINT `opening_times_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_opening_times_business_day` UNIQUE(`business_id`,`day`)
);

CREATE TABLE `sending_errors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`recipient_type` enum('lead','customer') NOT NULL,
	`recipient_id` int NOT NULL,
	`user_id` int NOT NULL,
	`business_id` int NOT NULL,
	`channel` enum('email','whatsapp') NOT NULL,
	`stage` varchar(32) NOT NULL,
	`error` varchar(255) NOT NULL,
	`warning_level` varchar(16),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sending_errors_id` PRIMARY KEY(`id`)
);

CREATE TABLE `settings` (
	`business_id` int NOT NULL,
	`validate_for_business_hours` boolean NOT NULL,
	`in_warm_up_mode` boolean NOT NULL,
	`max_emails` int NOT NULL,
	`max_whatsapps` int NOT NULL,
	`tolerance_rate` int NOT NULL,
	`minimum_wait_between_messages` int NOT NULL,
	`timezone` varchar(64) NOT NULL DEFAULT 'Europe/Rome',
	CONSTRAINT `settings_business_id` PRIMARY KEY(`business_id`)
);

CREATE TABLE `daily_usage` (
	`user_id` int NOT NULL,
	`day` date NOT NULL,
	`emails_sent` int NOT NULL DEFAULT 0,
	`whatsapp_sent` int NOT NULL DEFAULT 0,
	`last_message_sent_at` timestamp,
	CONSTRAINT `pk_daily_usage` PRIMARY KEY(`user_id`,`day`)
);

CREATE INDEX `idx_sent_messages_automation` ON `sent_messages` (`automation_id`);
CREATE INDEX `idx_sending_errors_automation` ON `sending_errors` (`automation_id`,`recipient_id`);
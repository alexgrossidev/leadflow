CREATE TABLE `automation_rules_steps` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`title` varchar(255),
	`description` varchar(255),
	`type` enum('email','whatsapp') NOT NULL,
	`email_subject` varchar(255),
	`content` text,
	`attachments` text,
	`delay` int NOT NULL DEFAULT 0,
	`delay_unit` varchar(16) NOT NULL DEFAULT 'minute',
	`step_sequence` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `automation_rules_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_automation_step_sequence` UNIQUE(`automation_id`,`step_sequence`)
);

CREATE TABLE `automation_rules` (
	`id` int NOT NULL,
	`user_id` int NOT NULL,
	`business_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`type` enum('customer','lead') NOT NULL DEFAULT 'lead',
	`paused` boolean NOT NULL DEFAULT false,
	`paused_at` timestamp,
	`field` varchar(255),
	`operator` varchar(32),
	`value` text,
	`scheduled_deletion_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `automation_rules_id` PRIMARY KEY(`id`)
);

CREATE TABLE `automation_targets` (
	`automation_id` int NOT NULL,
	`type` enum('lead','customer') NOT NULL,
	`original_id` int NOT NULL,
	`user_id` int NOT NULL,
	`business_id` int NOT NULL,
	`step` int,
	`step_id` int,
	`paused` boolean NOT NULL DEFAULT false,
	`paused_time` timestamp,
	`enrolled_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`last_execution_time` timestamp,
	`expected_execution_time` timestamp,
	CONSTRAINT `pk_automation_targets` PRIMARY KEY(`automation_id`,`type`,`original_id`)
);

CREATE TABLE `contacts` (
	`original_id` int NOT NULL,
	`type` enum('lead','customer') NOT NULL,
	`business_id` int NOT NULL,
	`user_id` int NOT NULL,
	`email` varchar(255),
	`phone` varchar(64),
	CONSTRAINT `pk_contacts` PRIMARY KEY(`original_id`,`type`,`business_id`)
);

CREATE TABLE `skipped_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`automation_id` int NOT NULL,
	`type` enum('lead','customer') NOT NULL,
	`original_id` int NOT NULL,
	`user_id` int NOT NULL,
	`business_id` int NOT NULL,
	`step` int,
	`step_id` int,
	`paused_time` timestamp,
	`enrolled_at` timestamp NOT NULL,
	`last_execution_time` timestamp,
	`expected_execution_time` timestamp,
	`reason_code` varchar(50) NOT NULL,
	`skipped_at` timestamp NOT NULL,
	CONSTRAINT `skipped_actions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_skipped_target` UNIQUE(`automation_id`,`type`,`original_id`)
);

CREATE INDEX `idx_automation_rules_business` ON `automation_rules` (`business_id`,`paused`);
CREATE INDEX `idx_automation_targets_paused` ON `automation_targets` (`automation_id`,`paused`);
--
-- Create model EmcReference
--
CREATE TABLE `emc_reference` (`id` bigint AUTO_INCREMENT NOT NULL PRIMARY KEY, `title` varchar(255) NOT NULL, `introduction` longtext NOT NULL, `legend` longtext NOT NULL, `definitions` longtext NOT NULL, `created_at` datetime(6) NOT NULL, `updated_at` datetime(6) NOT NULL, `change_id` bigint NOT NULL UNIQUE);
--
-- Create model EmcReferenceRow
--
CREATE TABLE `emc_reference_row` (`id` bigint AUTO_INCREMENT NOT NULL PRIMARY KEY, `key` varchar(64) COLLATE `utf8mb4_bin` NOT NULL, `label` longtext NOT NULL, `sort_order` integer UNSIGNED NOT NULL CHECK (`sort_order` >= 0), `reference_id` bigint NOT NULL);
--
-- Create model EmcReferenceTest
--
CREATE TABLE `emc_reference_test` (`id` bigint AUTO_INCREMENT NOT NULL PRIMARY KEY, `key` varchar(64) COLLATE `utf8mb4_bin` NOT NULL, `label` longtext NOT NULL, `group_label` varchar(255) NOT NULL, `standard_reference` varchar(255) NOT NULL, `sort_order` integer UNSIGNED NOT NULL CHECK (`sort_order` >= 0), `reference_id` bigint NOT NULL);
--
-- Create model EmcReferenceCell
--
CREATE TABLE `emc_reference_cell` (`id` bigint AUTO_INCREMENT NOT NULL PRIMARY KEY, `mark` varchar(3) COLLATE `utf8mb4_bin` NOT NULL, `remark` longtext NOT NULL, `reference_id` bigint NOT NULL, `row_id` bigint NOT NULL, `test_id` bigint NOT NULL);
--
-- Create constraint emc_row_unique_key on model emcreferencerow
--
ALTER TABLE `emc_reference_row` ADD CONSTRAINT `emc_row_unique_key` UNIQUE (`reference_id`, `key`);
--
-- Create constraint emc_row_owner on model emcreferencerow
--
ALTER TABLE `emc_reference_row` ADD CONSTRAINT `emc_row_owner` UNIQUE (`reference_id`, `id`);
--
-- Create constraint emc_row_valid_order on model emcreferencerow
--
ALTER TABLE `emc_reference_row` ADD CONSTRAINT `emc_row_valid_order` CHECK (`sort_order` > 0);
--
-- Create constraint emc_test_unique_key on model emcreferencetest
--
ALTER TABLE `emc_reference_test` ADD CONSTRAINT `emc_test_unique_key` UNIQUE (`reference_id`, `key`);
--
-- Create constraint emc_test_owner on model emcreferencetest
--
ALTER TABLE `emc_reference_test` ADD CONSTRAINT `emc_test_owner` UNIQUE (`reference_id`, `id`);
--
-- Create constraint emc_test_valid_order on model emcreferencetest
--
ALTER TABLE `emc_reference_test` ADD CONSTRAINT `emc_test_valid_order` CHECK (`sort_order` > 0);
--
-- Create constraint emc_unique_cell on model emcreferencecell
--
ALTER TABLE `emc_reference_cell` ADD CONSTRAINT `emc_unique_cell` UNIQUE (`row_id`, `test_id`);
--
-- Create constraint emc_valid_mark on model emcreferencecell
--
ALTER TABLE `emc_reference_cell` ADD CONSTRAINT `emc_valid_mark` CHECK (`mark` IN ('', 'X', '(X)'));
--
-- Raw SQL operation
--
ALTER TABLE emc_reference_cell ADD CONSTRAINT emc_cell_row_owner_fk FOREIGN KEY (reference_id, row_id) REFERENCES emc_reference_row (reference_id, id) ON DELETE CASCADE;
--
-- Raw SQL operation
--
ALTER TABLE emc_reference_cell ADD CONSTRAINT emc_cell_test_owner_fk FOREIGN KEY (reference_id, test_id) REFERENCES emc_reference_test (reference_id, id) ON DELETE CASCADE;
ALTER TABLE `emc_reference` ADD CONSTRAINT `emc_reference_change_id_82d42a72_fk_change_request_id` FOREIGN KEY (`change_id`) REFERENCES `change_request` (`id`);
ALTER TABLE `emc_reference_row` ADD CONSTRAINT `emc_reference_row_reference_id_29139e45_fk_emc_reference_id` FOREIGN KEY (`reference_id`) REFERENCES `emc_reference` (`id`);
ALTER TABLE `emc_reference_test` ADD CONSTRAINT `emc_reference_test_reference_id_cbc31213_fk_emc_reference_id` FOREIGN KEY (`reference_id`) REFERENCES `emc_reference` (`id`);
ALTER TABLE `emc_reference_cell` ADD CONSTRAINT `emc_reference_cell_reference_id_58bdf535_fk_emc_reference_id` FOREIGN KEY (`reference_id`) REFERENCES `emc_reference` (`id`);
ALTER TABLE `emc_reference_cell` ADD CONSTRAINT `emc_reference_cell_row_id_b1adc677_fk_emc_reference_row_id` FOREIGN KEY (`row_id`) REFERENCES `emc_reference_row` (`id`);
ALTER TABLE `emc_reference_cell` ADD CONSTRAINT `emc_reference_cell_test_id_d71e2b7d_fk_emc_reference_test_id` FOREIGN KEY (`test_id`) REFERENCES `emc_reference_test` (`id`);

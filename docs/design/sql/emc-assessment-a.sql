-- A: per-application EMC assessment, fixed reference content stays in configuration.
-- MySQL 8.4 / InnoDB / utf8mb4. Proposal only, not an applied Django migration.
-- change_request must already exist. Its id is a signed BIGINT in this project.
-- Use this alternative when the matrix is guidance and people fill the assessment.
CREATE TABLE `emc_assessment_a` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `change_id` BIGINT NOT NULL,
    `owner` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '负责人文字，不是系统审批账号',
    `result` LONGTEXT NOT NULL DEFAULT ('') COMMENT 'EMC评估结果及理由，人工填写',
    `test_plan` LONGTEXT NOT NULL DEFAULT ('') COMMENT '建议或确定的测试范围，可暂留空',
    `report_reference` LONGTEXT NOT NULL DEFAULT ('') COMMENT '报告或证据编号及说明，不存二进制附件',
    `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '空白、完成、不适用；不表示申请已审批',
    `date` DATE NULL DEFAULT NULL COMMENT '评估日期，空白与已填写有区别',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    UNIQUE KEY `emc_a_unique_change` (`change_id`),
    CONSTRAINT `emc_a_change_fk` FOREIGN KEY (`change_id`)
        REFERENCES `change_request` (`id`) ON DELETE CASCADE,
    CONSTRAINT `emc_a_valid_status` CHECK (`status` IN ('', 'completed', 'not_applicable'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='A版：每项申请独立EMC填写，原参考矩阵不逐单复制';

-- B: each application owns an editable reference matrix.
-- MySQL 8.4 / InnoDB / utf8mb4. Proposal only, not an applied Django migration.
-- Four tables preserve headings, editable rows, editable test columns and cells.
-- At first initialization, copy the reference definition into this application.
-- Do not seed X or (X) from question 7 or from an empty source cell.
CREATE TABLE `emc_reference_b` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `change_id` BIGINT NOT NULL,
    `title` VARCHAR(255) NOT NULL DEFAULT 'EMC 文档',
    `introduction` LONGTEXT NOT NULL DEFAULT ('') COMMENT '源表Introduction，中英文和换行保留',
    `legend` LONGTEXT NOT NULL DEFAULT ('') COMMENT '源表Legend，说明X及(X)的含义',
    `definitions` LONGTEXT NOT NULL DEFAULT ('') COMMENT '源表Definitions',
    `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (`id`),
    UNIQUE KEY `emc_b_unique_change` (`change_id`),
    CONSTRAINT `emc_b_change_fk` FOREIGN KEY (`change_id`)
        REFERENCES `change_request` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='B版：申请自己的EMC参考矩阵，不修改其他申请';

CREATE TABLE `emc_reference_row_b` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `reference_id` BIGINT NOT NULL,
    `row_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '稳定行标识，不随文字和显示顺序改变',
    `label` LONGTEXT NOT NULL DEFAULT ('') COMMENT '典型变更，如电源、电路板、接地更改',
    `sort_order` INT NOT NULL COMMENT '显示顺序，排序相同时再按id排序',
    PRIMARY KEY (`id`),
    UNIQUE KEY `emc_b_unique_row_key` (`reference_id`, `row_key`),
    UNIQUE KEY `emc_b_row_owner` (`reference_id`, `id`),
    CONSTRAINT `emc_b_row_reference_fk` FOREIGN KEY (`reference_id`)
        REFERENCES `emc_reference_b` (`id`) ON DELETE CASCADE,
    CONSTRAINT `emc_b_row_nonempty_key` CHECK (CHAR_LENGTH(`row_key`) > 0),
    CONSTRAINT `emc_b_row_valid_order` CHECK (`sort_order` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='B版：可修改、新增、删除的典型变更行';

CREATE TABLE `emc_reference_test_b` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `reference_id` BIGINT NOT NULL,
    `test_key` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '稳定测试列标识，如esd、surge',
    `group_label` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '抗干扰性测试或发射测试等分组',
    `standard_reference` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '原表标准文字，仅记录引用，不自动更新标准版本',
    `label` LONGTEXT NOT NULL DEFAULT ('') COMMENT '测试名称，中英文和换行保留',
    `sort_order` INT NOT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `emc_b_unique_test_key` (`reference_id`, `test_key`),
    UNIQUE KEY `emc_b_test_owner` (`reference_id`, `id`),
    CONSTRAINT `emc_b_test_reference_fk` FOREIGN KEY (`reference_id`)
        REFERENCES `emc_reference_b` (`id`) ON DELETE CASCADE,
    CONSTRAINT `emc_b_test_nonempty_key` CHECK (CHAR_LENGTH(`test_key`) > 0),
    CONSTRAINT `emc_b_test_valid_order` CHECK (`sort_order` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='B版：可修改、新增、删除的测试列';

CREATE TABLE `emc_reference_cell_b` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `reference_id` BIGINT NOT NULL,
    `row_id` BIGINT NOT NULL,
    `test_id` BIGINT NOT NULL,
    `mark` VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '空白未知，X需要测试，(X)需要分析后决定',
    `remark` LONGTEXT NOT NULL DEFAULT ('') COMMENT '该格的说明或分析理由，允许草稿为空',
    PRIMARY KEY (`id`),
    UNIQUE KEY `emc_b_unique_cell` (`row_id`, `test_id`),
    KEY `emc_b_cell_row_owner` (`reference_id`, `row_id`),
    KEY `emc_b_cell_test_owner` (`reference_id`, `test_id`),
    CONSTRAINT `emc_b_cell_row_fk` FOREIGN KEY (`reference_id`, `row_id`)
        REFERENCES `emc_reference_row_b` (`reference_id`, `id`) ON DELETE CASCADE,
    CONSTRAINT `emc_b_cell_test_fk` FOREIGN KEY (`reference_id`, `test_id`)
        REFERENCES `emc_reference_test_b` (`reference_id`, `id`) ON DELETE CASCADE,
    CONSTRAINT `emc_b_valid_mark` CHECK (`mark` IN ('', 'X', '(X)'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    COMMENT='B版：同一申请内行与测试列的交叉格，防止跨矩阵关联';

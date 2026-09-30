# 表单填报系统

面向公司内网电脑端的设计变更填报系统，将现有八张 Excel 工作表转为网页填写，并完成保存恢复、指定审批人、并行批准和留言沟通的两周可演示 MVP。

当前已完成首批“登录 → 新建草稿 → 填写概述 → 保存 → 重新打开恢复”，数据存入 MySQL。物料明细、其他工作表、提交审批及留言在后续阶段开发。两周从实际开发启动日起计算，目标为 10 个工作日，具体进度以实际开发为准。

启动、演示账号和测试方法见 [本机开发与演示](docs/DEVELOPMENT.md)，表单来源和字段对应关系见 [字段说明](docs/FIELD_MAP.md)。

阶段一的测试证据、代码复查、修复过程和后续验证缺口见 [测试复查与开发记录](docs/testing/REVIEW-2026-09-30.md)。

## 目录导航

```text
表单填报系统/
├─ README.md                 项目入口和目录导航
├─ backend/                  Django 后端、迁移和测试
├─ frontend/                 React 前端
├─ scripts/                  启动脚本
├─ docs/
│  ├─ MVP.md                 已确认范围与待完成项
│  ├─ DEVELOPMENT.md         安装、启动和验证
│  ├─ FIELD_MAP.md           Excel 字段对应关系
│  ├─ design/                Word 技术方案和设计图
│  └─ testing/
│     ├─ REVIEW-2026-09-30.md 测试复查与开发记录
│     └─ manual/             人工反馈和 images 截图（仅本机）
├─ reference/                原始 Excel 等业务资料（仅本机）
├─ .local/                   本机配置、密码及临时验收产物（不提交）
└─ .venv/                    Python 虚拟环境（不提交）
```

日常开发从 `frontend`、`backend` 开始，查方案进入 `docs`，人工测试反馈放入 `docs/testing/manual`，截图放入其中的 `images`。`node_modules`、构建目录和虚拟环境由工具管理，不手动混入业务资料。

## 方案与范围

- [现有技术方案 1.4](docs/design/表单填报系统_技术方案1.4.docx)：保留原文件、版式和图片。
- [两周 MVP 确认范围](docs/MVP.md)：记录 2026-09-30 确认的流程、实现边界和验收要求。
- [陈氏 ER 图](docs/design/images/ER图新.png)与[序列图](docs/design/images/序列图.png)：现有图展示基础填报部分，审批和留言由 MVP 补充文字说明。

技术方案 1.4 中“暂不实现审核流程、审核留痕”、将基本审批列为后续扩展以及原实施安排，与本次确认范围存在差异。开发范围以 `docs/MVP.md` 为准。根据 2026-09-30 确认的调整，数据库改为 MySQL；其他技术选型、八张工作表内容及既有规则沿用技术方案。原 Word 中的 PostgreSQL 选型作为历史参考，不再作为开发依据。

## 技术选型

- 前端：React、TypeScript、Vite、Ant Design；TanStack Query 管理接口数据和保存状态。
- 后端：Django、Django REST Framework。
- 数据库：MySQL Community Server 8.4 LTS，采用 InnoDB 和 `utf8mb4`。
- 部署：公司内网，以电脑端为主要使用场景；开发开始时确认演示环境及公司 IT 要求。

Django 使用内置 MySQL 后端和 `mysqlclient` 驱动连接数据库。本批已实现草稿保存的事务和申请主记录行锁；后续提交与批准接口将复用同一锁定方式，并增加审批唯一约束、重复批准保护及同时批准时的状态判断。

Windows 开发环境安装 [MySQL Community Server 8.4 LTS](https://dev.mysql.com/downloads/mysql/8.4.html)，选择 Windows 64 位 MSI 安装包，并运行随附的 MySQL Configurator 完成配置；本机默认端口为 3306。Django 和 `mysqlclient` 在项目 Python 虚拟环境中安装。兼容性与配置要求见 [Django MySQL 文档](https://docs.djangoproject.com/en/5.2/ref/databases/#mysql-notes)。

## 八张工作表

概述与物料处置、问题、ECR、ECO、EMC reference、设计变更执行计划、实质性变更评估表、实质性变更评估子表。

辅助工作表中的问题与行动对应关系、判断规则作为系统配置使用。EMC reference 继续只读展示；是否另存 EMC 评估记录仍按原方案待确认。

## 已确认流程

**草稿 → 待审批 → 已批准**

草稿可填写、修改、保存和重新打开。申请者从已有用户中指定至少一名审批人后提交，后端锁定表单及审批人名单，并同时为所有指定人员生成各自的待审批任务。审批人只能批准自己的任务；全部人员批准后，申请进入已批准。

待审批期间，申请者和指定审批人可以追加留言。全部批准后，表单、审批结果和留言均只读。不设置独立的“填写完成”状态或“发布”操作。

## 原有图示

以下两张图原样保留，展示基础填报数据与交互，不代表审批及留言的完整模型。序列图中的 PostgreSQL 标签为原方案标注，实际实现按当前选型使用 MySQL；网页、后端与数据库之间的基础交互关系继续适用。

![陈氏 ER 图](docs/design/images/ER图新.png)

![基础填报序列图](docs/design/images/序列图.png)

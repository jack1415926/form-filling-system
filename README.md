# 表单填报系统

将指定八张Excel设计变更工作表转为电脑端网页。前端React／TypeScript／Vite／Ant Design／TanStack Query；后端Django REST Framework和MySQL。

## 当前状态

更新日期：2026-10-20。迁移终点为 **0027_remove_reviewfeedback**；26个业务模型及3张人员关联表，共29张业务表、230个字段。结构见[完整字段与关系](docs/design/DATABASE-ER-FULL.md)。各设备独立配置和迁移，Git更新不升级数据库。

| 范围 | 已实现能力 |
| --- | --- |
| 八表填写 | 概述、物料／处置、27题及批量回答、EMC、执行计划、人工实质性评估；局部保存、自动保存及失败输入保护 |
| ECR／ECO | 独立填写、多人行动分配、逐人确认、整阶段退回、新轮重提、原作者复核、所选批准人全部同意、指定发布 |
| 来源与历史 | 已发布ECR复制唯一关联ECO；填写人指定／交接；来源只读、六阶段导航；新轮冻结完整表单，旧轮缺失快照不补造 |
| 提醒与反馈 | 任务、修订、复核、待发布及ECO填写权限提醒，按账号持久已读；独立系统反馈、用户追加、管理员公开回复／状态处理 |
| 删除与测试数据 | ECR发起人明确确认后可整项永久删除，有ECO须一并确认；开发环境可生成五种状态的合成测试用例 |

待发布消息、“待我发布／已发布”和工程变更统一进入当前流程发布区；指定发布权限按同一接口判断，审核历史保持只读。读取／保存响应校验、原请求查询与重试、迟到响应及输入保留已完善，验证范围见[测试说明](docs/testing/README.md)。

旧整单提交、公开审核、旧role和普通审核留言已停用。权限按账号、申请、轮次和任务判断，staff／superuser不绕过业务授权；详细规则统一见[MVP](docs/MVP.md)。

**仍待完成：**完整用户业务验收、跨设备实际访问、正式部署与恢复验证。详见[当前待办](docs/REQUIREMENTS-REFACTOR-TODO.md)。技术测试通过不等于这些事项已完成。

## 启动与验证

- 本机环境、安装、启动和迁移：[开发说明](docs/DEVELOPMENT.md)。
- 公司内网：运行 `pwsh -NoProfile -File scripts/start-lan.ps1`，以本次输出的地址为准；见[内网说明](docs/COMPANY-LAN.md)。
- 合成测试数据：工程变更列表的生成入口，或 `pwsh -NoProfile -File scripts/test-data.ps1`；见[测试数据说明](docs/TEST-DATA.md)。
- 自动化入口、覆盖范围及最新结果：[测试说明](docs/testing/README.md)。需要持续防止的问题见[关键回归](docs/testing/REGRESSIONS.md)。

## 文档入口

| 文档 | 职责 |
| --- | --- |
| [MVP](docs/MVP.md) | 当前业务规则和范围 |
| [开发说明](docs/DEVELOPMENT.md) | 环境、安装、启动、迁移、检查和排障 |
| [项目指南](docs/PROJECT_GUIDE.md) | 代码地图、数据职责、保存及历史读取链路 |
| [字段映射](docs/FIELD_MAP.md) | 原Excel坐标、接口字段和模板疑点 |
| [待办](docs/REQUIREMENTS-REFACTOR-TODO.md) | 尚未完成的业务验收、部署验证和待确认事项 |
| [当前线框图](docs/线框图1.4.drawio) | 17页可编辑界面说明，含异常恢复及独立系统反馈／反馈管理 |
| [异常场景索引](docs/testing/FAULT-INJECTION.md) | 开发排查与自动化覆盖映射；无需逐项手工注入 |
| [阶段图](docs/design/STAGES-CURRENT.md)／[序列图](docs/design/SEQUENCES-CURRENT.md)／[数据库](docs/design/DATABASE-ER-FULL.md) | 当前流程与结构 |
| [MT交付确认](docs/MT-阶段交付与需求确认-2026-10-14.md) | 待与MT确认的范围、职责、验收标准及交付顺序 |

同一主题持续更新对应文档；修复原因和必要验证并入已有回归说明，不再为每一小批新增流水账。提交和发布状态以Git记录为准。

## 数据边界

Git只同步代码和文档；`.local`、`.venv`、账号／密码、数据库／备份、源Excel、样例和人工截图不上传。新申请不预填旧样例，测试数据生成会新增记录，不覆盖已有申请。实际端口、网络和数据库连接以本机配置及启动输出为准。

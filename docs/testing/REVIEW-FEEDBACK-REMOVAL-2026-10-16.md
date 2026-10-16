# 移除旧普通审核留言表

日期：2026-10-16。用户在逐表审查后明确授权删除唯一的旧表候选review_feedback。

## 修改范围

删除ReviewFeedback模型，新增0027_remove_reviewfeedback迁移，通过DeleteModel删除旧表；0001～0026迁移历史保留。删除审核详情对旧留言的查询、feedback／can_feedback响应字段、未引用的TextValues旧输入类和feedback动作分支；旧普通留言POST现在返回404。前端移除对应类型、校验和“历史留言，只读”栏目，更新审核说明；移除只为旧表级联验证而创建的测试夹具，原整项删除专项继续覆盖现有表。

正式审核意见review_issue／review_issue_event、独立系统反馈三表，以及行动、多人分配、轮次快照均保持原功能；不清理其他旧字段，不增加归档、备份、额外清理命令或回收站。

## 验证及本机应用

- 应用前再次只读确认review_feedback为0行。迁移计划仅含DeleteModel ReviewFeedback，本机目标执行`migrate changes 0027 --noinput`成功。
- 42项真实MySQL专项通过：旧模型／表确已移除、审核响应不再含旧字段、旧动作404；同时覆盖正式意见及回应、轮次历史、整项删除／回滚、权限和独立系统反馈。独立测试库随后销毁。
- 13项前端审核专项、TypeScript／Vite构建、lint通过。`makemigrations --check --dry-run`无额外变更，未运行全量业务／浏览器验收。构建保留既有大包提示。
- 本机其他29张业务表逐表行数和全部行内容摘要与删除前一致；审核详情在当前开发库只读请求200，issues与history保留，feedback／can_feedback不存在。只保存核对摘要，不复制业务原文。
- 本机迁移终点为0027，无待应用迁移；26张业务模型表＋3张人员关联表，共29表／230字段，58条外键约束涉及60个外键列。MySQL保持运行，未修改其他设备。
- 当前完整字段文档、Mermaid源、README、项目指南、开发说明、字段映射及相关业务规则同步至0027；Mermaid解析／渲染通过。删除前的0026核验和审查记录保留为历史，并加执行完成入口。

本机数据摘要位于被Git忽略的.local/review-feedback-removal-20261016-before.json和after.json；结构核对在.local/database-schema-0027-verification.json。迁移回退仅能重建空表，不能恢复被删除的旧留言；其他设备若有旧留言，须核对保留要求后再应用。

当前结构见[完整字段与关系](../design/DATABASE-ER-FULL.md)，原判断见[删除前逐表审查](DATABASE-SIMPLIFICATION-AUDIT-2026-10-16.md)。尚未提交或推送。

# 当前项目序列图（2026-10-09）

依据当前React、Django DRF及MySQL实现更新。原方案图片仅作历史参考；以下图描述已实现功能，不加入规则维护、导入导出或未确认流程。

## 原图核对

- 原图数据库PostgreSQL与当前MySQL不一致。
- action_response、execution_plan_item、significant_response及change_request.significant_conclusion等旧表/字段不对应当前结构。
- 当前实质性评估为主表加A到E抽屉及人工结论，不是强制逐题向导。
- 补充2秒自动保存、局部PATCH、在途输入保护、提交锁定、按轮审核、退回重提、正式意见、系统反馈追问和两套持久已读。
- PROJECT_GUIDE中的单格保存图补入自动保存，并避免把在途输入一律清空。

## 基础填报、保存与恢复

```mermaid
sequenceDiagram
    actor U as 填写员
    participant F as React网页
    participant A as Django DRF
    participant C as 固定配置JSON与代码
    participant D as MySQL
    U->>F: 登录并新建申请
    F->>A: Session登录，POST /api/changes/
    A->>D: 新建change_request，status=draft
    D-->>A: 申请ID与概述
    A-->>F: 返回本人草稿
    U->>F: 打开各填写页签
    F->>A: GET问题、ECR、ECO、EMC、计划、实质性评估
    A->>C: 读取固定题目、行动映射和参考规则
    A->>D: 读取已保存答案与各模块结果
    A-->>F: 合并固定定义和填写结果
    Note over F,D: 查看不创建填写数据；EMC首次实际保存形成本单参考副本
    loop 实际修改后停顿2秒，或手动保存
        U->>F: 填写或修改业务字段
        F->>F: 校验日期，计算实际字段差异，串行调度
        F->>A: 局部PATCH，Cookie、CSRF、X-Expected-User
        A->>D: 事务锁定父申请，重检本人及draft/returned状态
        A->>A: 校验字段、选项、日期及模块完整性
        A->>D: 更新该模块填写与申请时间，提交事务
        A-->>F: 返回完整模块结果与updated_at
        F->>F: 校验响应，更新基线，保留在途新增输入
    end
    Note over F,A: 新物料首次创建须手动确认；UUID保证同一新增请求不重复
    Note over C,F: ECR/ECO各61行动按已保存问题触发；隐藏不删除旧填写
    Note over F,D: 实质性评估为主表及A到E抽屉，结论人工填写，不强制逐题向导
    opt 保存失败或结果未确认
        A-->>F: 校验失败、网络错误或30秒超时
        F->>F: 保留输入；有限重试或原请求查询/重试
    end
    U->>F: 重开申请或同账号重登
    F->>A: GET本人申请与模块
    A->>D: 读取已保存结果
    A-->>F: 恢复填写；脏输入受保护，旧响应不覆盖新基线
```

[Mermaid源文件](SEQUENCE-FILL-SAVE.mmd) · [SVG](images/SEQUENCE-FILL-SAVE.svg) · [PNG](images/SEQUENCE-FILL-SAVE.png)

## 提交审核、意见与退回重提

```mermaid
sequenceDiagram
    actor U as 填写员
    actor R as 有权审核员
    participant F as React网页
    participant A as Django DRF
    participant D as MySQL
    U->>F: 保存表单，选择指定或公开审核
    F->>A: POST submission，expected_round与新UUID
    A->>D: 锁定申请，核对本人、状态、标题和ECR编号
    A->>A: 校验有效审核员及未解决意见的回应/审核安排
    A->>D: 新建review_round与review_record，申请置pending
    A-->>F: 返回轮次、方式及名单，八表锁定
    R->>F: 打开指定或公开任务
    F->>A: GET当前有权轮次及八表
    A-->>F: 返回授权内容，只读展示
    alt 需要修改
        R->>F: 列出多条意见，确认退回
        F->>A: POST退回，当前轮次与UUID
        A->>D: 锁申请，保存review_issue/event及退回原因，置returned
        A-->>F: 通知最新状态
        U->>F: 修订八表并逐条回应
        F->>A: PATCH表单，POST意见回应及原版本
        A->>D: 保存修订与review_issue_event
        Note over R,D: 退回期间审核员可看意见/回应，不可读取修订中的八表正文
        U->>F: 重提，未解决意见存在时沿用审核安排
        F->>A: POST submission，新UUID与expected_round
        A->>D: 新建审核轮次，个人批准重新计数，置pending
        R->>F: 原提出者复核自己的意见
        F->>A: POST确认解决或继续修改，轮次/版本/UUID
        A->>D: 锁申请并追加意见处理事件
    else 内容可以批准
        Note over R,F: 无需退回，直接进入下方个人批准操作
    end
    R->>F: 意见均解决后，本人同意批准
    F->>A: POST批准，当前轮次与UUID
    A->>D: 锁申请，重检权限、状态和未解决意见，记录个人批准
    alt 指定人员全部批准，或公开两名不同审核员批准
        A->>D: 当前轮及申请置approved
        A-->>F: 整单审核通过，保持只读
    else 尚未达到整单条件
        A-->>F: 个人批准已记录，整单仍pending
    end
    Note over A,D: 旧轮请求拒绝；重复请求去重；最终批准与退回按同一申请锁串行
    loop 每30秒、聚焦或手工刷新审核消息
        F->>A: GET /api/review/inbox/
        A-->>F: 本人待办及未读批次签名
    end
    U->>F: 或审核员标为已读
    F->>A: POST审核已读，申请/轮次/签名
    A->>D: 锁申请，核对快照，保存review_inbox_read
    A-->>F: 清除对应提醒，业务待办保留
```

[Mermaid源文件](SEQUENCE-REVIEW.mmd) · [SVG](images/SEQUENCE-REVIEW.svg) · [PNG](images/SEQUENCE-REVIEW.png)

## 系统反馈、追加意见与未读

```mermaid
sequenceDiagram
    actor U as 填写员或审核员
    actor M as 反馈管理员
    participant F as React网页
    participant A as Django DRF
    participant D as MySQL
    U->>F: 提交问题/建议/其他及文字
    F->>A: POST system-feedback，UUID
    A->>D: 创建system_feedback，状态pending，重复UUID去重
    A-->>F: 返回本人反馈详情，原文只读
    M->>F: 查看反馈管理列表和详情
    F->>A: GET manage，后端核对反馈管理员组
    A-->>F: 返回有权反馈及公开时间线
    M->>F: 回复或更新状态
    F->>A: POST actions，UUID与expected_version
    A->>D: 锁反馈，重检版本，追加manager事件并更新状态
    Note over A,D: 关闭或重新打开须说明，反馈不改变申请审核
    loop 30秒轮询、聚焦或手工刷新
        F->>A: GET system-feedback/inbox
        A->>D: 查询用户入站事件及system_feedback_read
        A-->>F: 未读反馈、message_version、read_version
        F->>F: 提示与红点；列表逐条标未读
    end
    U->>F: 点击同一反馈的新消息
    F->>A: 主动GET详情，即使该反馈已打开
    A-->>F: 返回新时间线
    F->>F: 保留原草稿；按已读边界突出未读回复
    U->>F: 追问或追加意见
    F->>A: POST followups，UUID与expected_version
    A->>D: 锁本人反馈，追加followup事件
    opt 原反馈已关闭
        A->>D: 自动转为processing
    end
    A-->>F: 返回完整时间线；管理人员收到新入站提醒
    Note over F,D: 本人发送不标未读；过期版本不写入，输入保留；未知结果查询或原请求重试
    U->>F: 或反馈管理员标为已读
    F->>A: POST inbox/read，反馈ID与message_version
    A->>D: 锁反馈，核对入站快照，保存system_feedback_read
    A-->>F: 列表与详情未读消失，反馈状态不改变
```

[Mermaid源文件](SEQUENCE-FEEDBACK.mmd) · [SVG](images/SEQUENCE-FEEDBACK.svg) · [PNG](images/SEQUENCE-FEEDBACK.png)

## 单格物料保存

```mermaid
sequenceDiagram
    actor U as 填写员
    participant F as MaterialForm及自动保存调度
    participant A as api.ts
    participant V as Django DRF
    participant D as MySQL
    U->>F: 清空一个位置的备注，保留处置NA
    F->>F: 记录修改字段与当前基线
    F->>A: 停顿2秒或手动保存，仅PATCH变化的备注
    A->>V: Cookie、CSRF、X-Expected-User
    V->>D: 事务锁定父申请，核对本人及draft/returned状态
    V->>V: 校验类别、位置、处置选项及字段
    V->>D: 更新备注，省略的处置NA保持，更新时间
    D-->>V: 提交事务
    V-->>A: 返回物料、处置和updated_at
    A-->>F: 已验证响应
    F->>F: 更新已保存基线，保留请求期间新输入
    opt 失败或结果未确认
        A-->>F: 错误或30秒超时
        F->>F: 保留输入与请求信息，有限重试或人工处理
    end
```

[Mermaid源文件](SEQUENCE-MATERIAL-SAVE.mmd) · [SVG](images/SEQUENCE-MATERIAL-SAVE.svg) · [PNG](images/SEQUENCE-MATERIAL-SAVE.png)

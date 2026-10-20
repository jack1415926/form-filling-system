# 当前保存与ECR／ECO流程序列

更新日期：2026-10-20，依据0027代码。规则见[MVP](../MVP.md)，授权与数据职责见[项目指南](../PROJECT_GUIDE.md)。

## 保存与恢复

```mermaid
sequenceDiagram
    actor U as 用户
    participant F as React编辑器
    participant A as Django接口
    participant D as MySQL
    U->>F: 修改字段，停顿2秒或手动保存
    F->>F: 校验输入，计算局部差异，串行排队
    F->>A: PATCH，Cookie／CSRF／预期账号
    A->>D: 事务锁定父申请，重检权限和状态
    A->>D: 校验并保存，更新申请时间
    D-->>A: 提交事务
    A-->>F: 完整模块响应及updated_at
    F->>F: 校验响应、更新基线、保留在途新输入
    opt 结果未确认
        F->>F: 保留输入和原请求
        F->>A: 查询回执或按原请求重试
    end
    Note over F,D: 新物料首次创建须手动保存；基础字段没有通用多人冲突控制
```

查询只读取已有结果，不补发写入。请求未发送时查不到原回执，需原请求重试才会提交；实际已执行但回包丢失时，查到原凭据即可恢复。成功响应结构不完整时保留输入及原请求，不能仅凭HTTP 200更新保存基线。普通字段保存可有限重试，批准／发布等业务确认不自动重放。

## 两阶段独立流转

```mermaid
sequenceDiagram
    actor O as 当前填写人
    actor T as 行动负责人
    actor R as 所选批准人
    actor I as 原意见提出者
    actor P as 指定发布人
    participant A as 业务接口
    participant D as MySQL
    O->>A: 提交当前ECR或ECO，expected_round／UUID
    A->>D: 同一事务锁父申请并校验准入
    A->>D: 冻结人员、任务及本轮完整表单，置pending
    loop 每名负责人
        T->>A: 保存本人任务结果，再显式确认
        A->>D: 核对轮次／version／UUID，保存回执
    end
    opt 任务负责人或批准人提出意见并退回
        A->>D: 当前轮returned，保留旧轮证据
        O->>A: 修订基础、逐条回应，再提交新轮
        A->>D: 新建轮次，任务和批准重新确认
        I->>A: 复核本人意见
    end
    loop 每位所选批准人
        R->>A: 同意批准
        A->>D: 全部任务已确认且意见解决后记录个人同意
    end
    A->>D: 全部指定批准人同意后置approved
    P->>A: 显式发布当前流程
    A->>D: 校验本轮证据，置published并只读
    opt 已发布ECR的发起人或实际发布人创建ECO
        O->>A: 指定ECO填写人并请求创建
        A->>D: 事务复制独立基础数据，建立唯一来源
        Note over O,D: ECO另行提交、批准、发布，不回写来源ECR
    end
```

指定发布人的权限由后端决定；待发布消息、“待我发布／已发布”及工程变更现已统一进入当前流程总览发布区，是否为发起人不改变权限。批准／退回历史读取本轮快照，不能替换为正在修订的实时正文。ECO创建不会修改已发布来源ECR的时间戳，迟到读取合并时须保留既有ECO关联及创建回执；条件已变时停止不能继续的原请求，不伪报原操作成功。

独立系统反馈另有提交、追加、公开处理及已读链路，不调用上述业务批准／发布动作。界面见[线框图](../线框图1.4.drawio)第17页，规则见[MVP](../MVP.md#独立系统反馈与反馈管理)，恢复与版本回归见[关键回归](../testing/REGRESSIONS.md)。

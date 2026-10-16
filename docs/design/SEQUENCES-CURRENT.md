# 当前保存与ECR／ECO流程序列

更新日期：2026-10-16，依据0027代码。规则见[MVP](../MVP.md)，授权与数据职责见[项目指南](../PROJECT_GUIDE.md)。

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

指定发布人的权限由后端决定；当前消息／待我发布入口缺少发布区的问题仍见[待办](../REQUIREMENTS-REFACTOR-TODO.md)。批准／退回历史读取本轮快照，不能替换为正在修订的实时正文。

# 异常界面清单与故障注入方法

更新：2026-10-20。本文是异常场景索引和开发调试配方，**不是要求用户逐项执行的验收清单**。实际代码、注入脚本及自动化核对结果见[测试说明](README.md)。自动化覆盖不等于下列所有界面均已逐项人工验证；不制造真实数据库故障。

覆盖正式工作台中的错误条、未知结果恢复区、异常消息、数据缺失、状态冲突、未保存保护及输入阻断。ECR/ECO共用组件合并列出，不为同一提示重复计数。普通操作确认、只读状态与布局演示另行说明。

## 1. 提交未确认：两种不同场景

先使用自己的合成测试草稿，满足提交条件；从Network取得申请数字ID。将[browser-fault-injection.js](../../scripts/browser-fault-injection.js)保存为DevTools Sources → Snippets并运行。安装无默认规则，不发请求；整页刷新会移除脚本。旧Snippet需要替换为当前文件，单纯clear不会升级脚本。

### 请求没有发送：查询不能变成提交

```javascript
var C = 123; // 换成测试申请ID
ecFault.clear();
ecFault.add({url: `/api/changes/${C}/stage-submission/`, method: 'POST', mode: 'network'});
```

点击提交并确认后立即出现未知结果。点击“查询结果”会发送GET stage-workflow，不受这条POST规则影响；应显示“已查询，暂未查到原提交记录……”。这表示查询完成但没有找到回执，不是按钮失效。

执行`ecFault.clear()`后再次查询仍然查不到：clear只移除规则，不补发原提交、不清除页面恢复状态。继续操作应点击“按原请求重试”，这一步才会真实提交测试草稿。若不clear，重试POST仍会失败。`timeout`同样不发送请求，但需等约30秒；仅检查界面优先用network。

### 已执行但成功响应丢失：查询可以恢复

```javascript
ecFault.clear();
ecFault.add({url: `/api/changes/${C}/stage-submission/`, method: 'POST',
  mode: 'after-network', forward: true});
```

这会真实提交测试草稿，再让页面看到断连。出现未知结果后点击查询，应识别原请求回执、解除未知状态，且不新增另一轮。仅拦POST时查询不需要clear；重试前移除故障可避免重复制造丢包。

结束输入`ecFault.restore()`，它恢复fetch，不刷新、不清除草稿、不替业务确认结果。若之前安装过`window.__originalFetch`简易拦截，先撤销，避免叠加。

## 2. 脚本模式与使用边界

脚本只匹配当前标签页、同源`/api/`请求，并检查HTTP方法。以`/`开头的完整路径精确匹配pathname，不会误拦其子接口；带查询参数时精确匹配路径及查询串；其他字符串作为片段匹配，正则匹配路径及查询串。规则持续生效，直到手动清空；避免自动保存重试时意外放行写入。不匹配的请求仍正常执行。

```javascript
ecFault.status();   // 当前规则
ecFault.history();  // 命中过的方法、路径、模式及是否转发，不记录密码或正文
ecFault.clear();    // 清空规则，在途模拟仍等请求期限
ecFault.restore();  // 撤销拦截，并结束在途模拟，不刷新页面
```

| mode | 效果 | 匹配请求会不会到后端 |
| --- | --- | --- |
| `http`，另设`status`、可选`body` | 指定HTTP错误；默认空对象以检查应用的状态码提示，提供body则检查后端明细展示；可用ms延迟 | 不会 |
| `network` | 立即连接中断 | 不会 |
| `timeout` | 挂起，项目约30秒超时 | 不会 |
| `body-timeout` | 200状态，但响应正文读不完 | 不会 |
| `invalid-json` | 200状态，正文不是JSON | 不会 |
| `json`，另设`body` | 200状态、指定JSON，测试严格校验接口的缺字段 | 不会 |
| `patch`，`edit: data => data` | 读取真实成功GET，修改交给页面的数据；仅允许GET | 会，只读取 |
| `delay`，`ms` | 延迟后执行原请求；默认35秒先碰到项目30秒期限 | GET可能读取；非GET须`forward:true` |
| `after-network`，`forward:true` | 真实请求成功后，让页面看到断连 | **会，写操作真实执行** |
| `after-timeout`，`forward:true` | 真实请求成功后，让页面等到超时 | **会，写操作真实执行** |

`http 500`未发送写入，只验证界面。验证“实际已执行，但回包丢失后不重复操作”须使用`after-*`，并核对真实轮次、记录和回执。提交、发布、删除、交接、回应、标已读都会改测试数据；这些模式只用于自己的合成测试记录。

读取故障要先设置、再进入页面或点击刷新。已有缓存可能不发请求；可保存输入后离开，等超过30秒再进入。**整页刷新会移除脚本**，不能先安装再刷新并声称故障仍在。冷启动故障需要在目标GET发出前注入，或使用DevTools请求阻止功能；按URL阻止参考[Chrome官方说明](https://developer.chrome.com/docs/devtools/request-conditions)。

`patch`只改变浏览器所见，不能证明后端权限／状态已改变。结束后先保留测试输入，再刷新清理模拟缓存。伪造JSON如果缺少身份、轮次、事件等关联字段，会先触发响应格式错误，不能当作业务状态变化验证。

## 3. 通用配方

`C`申请ID、`R`轮次、`T`任务ID、`M`物料ID、`F`系统反馈ID、`I`正式意见ID，均从自己的测试记录或Network取得。每个场景先`ecFault.clear()`，只设置本次规则。

```javascript
var C = 123, R = 2, T = 9, M = 5, F = 7, I = 1;
```

### A：读取失败

```javascript
ecFault.add({url: `/api/changes/${C}/questions/`, method: 'GET', mode: 'http', status: 503});
// 再进入问题评估；恢复后点“重试”。
```

### B：保存失败／明确拒绝

```javascript
ecFault.add({url: `/api/changes/${C}/`, method: 'PATCH', mode: 'http', status: 400,
  body: {title: ['模拟：标题校验未通过。']}});
// 修改概述，应保留输入，显示字段错误，而非“已保存”。
```

### C：超时、断连、正文挂起

```javascript
ecFault.add({url: `/api/changes/${C}/questions/`, method: 'PATCH', mode: 'timeout'});
// 改成network立即触发，body-timeout测试正文读取也有期限。
```

自动保存的网络／5xx错误有有限重试，通常先5秒、再15秒；创建、手动保存和业务确认不都采用此策略。规则持续生效会让重试继续失败，解除后可能需要手动保存，不能只等待。

### D：认证、CSRF和普通权限拒绝

```javascript
ecFault.add({url: `/api/changes/${C}/questions/`, method: 'PATCH', mode: 'http', status: 403,
  body: {detail: '模拟登录失效', code: 'not_authenticated'}});
// CSRF：body改为{detail:'模拟安全校验失败',code:'csrf_failed'}。
// 普通权限不足：body改为{detail:'没有本轮审核权限。'}，不带认证code。
```

模拟失效不注销服务器会话。真实失效：同一浏览器B标签退出，A不刷新后保存，再用原账号重新登录。换账号会按原规则关闭原账号页面，不能用它测试同账号草稿恢复。重新登录不能恢复已撤销的业务权限。

### E：已执行但回包丢失

```javascript
ecFault.add({url: `/api/changes/${C}/stage-submission/`, method: 'POST',
  mode: 'after-network', forward: true});
```

出现未知结果后查询结果（仅拦POST时GET不受影响；多条或GET规则存在时先检查status并清空）。已提交的原轮次应被识别，不得新增一轮；原请求重试的`request_id`应保持不变。对创建物料、ECO或生成用例，还要核对没有重复记录。只看错误条消失不够。

ECO交接等操作可能自动查询回执并立即确认成功，不一定一直停在未知提示。新物料要保持原抽屉，以原创建标识重试，不要关闭重建。

### F：历史快照缺失

```javascript
ecFault.add({url: `/api/changes/${C}/review-rounds/${R}/form-snapshot/`, method: 'GET', mode: 'patch',
  edit: data => ({...data, snapshot: null, tasks: []})});
```

展开完整历史表单，应显示“本轮未保存完整历史表单”，不能用当前修订正文替代。不删除数据库历史。

### G：正式意见版本变化

先在当前意见中输入未发送回应，再设置规则并点“刷新意见”：

```javascript
ecFault.add({url: `/api/changes/${C}/review-rounds/${R}/`, method: 'GET', mode: 'patch', edit: data => {
  const issue = data.issues.find(item => item.id === I);
  if (!issue) throw new Error('没有找到指定测试意见');
  issue.version += 1;
  data.updated_at = new Date().toISOString();
  return data;
}});
```

应显示“意见已更新，未发送文字保留……”而非覆盖草稿。时间戳需比缓存新；结束后清空规则，保留需要的测试文字再刷新。

系统反馈的版本与`events`数量、`base_version`和状态链关联更严格，**不要仅做`version++`**。用第二测试账号实际追加／处理，再在原页刷新；或者覆写完整合法的新版本响应。否则看到的是响应不完整，而不是版本变化提示。

### H：重新登录后的旧错误

```javascript
ecFault.add({url: '/api/review/inbox/', method: 'GET', mode: 'http', status: 401,
  body: {detail: '模拟旧请求登录失效'}, ms: 15000});
```

点刷新消息，15秒内通过系统反馈面板的重新登录完成同账号登录。旧GET可在原读取区域提示“登录状态已更新”，但不能再次显示全局登录失效恢复条。不要用超过30秒的延迟，那会先触发超时。

## 4. 异常场景清单

### 4.1 全局身份、HTTP与退出

来源：[App](../../frontend/src/App.tsx)、[API](../../frontend/src/api.ts)、[后端错误分类](../../backend/changes/api_errors.py)。

| ID | 异常界面 | 故障与触发方式 | 恢复检查 |
| --- | --- | --- | --- |
| G01 | 登录框内账号／密码错误 | B：`POST /api/auth/login/`400及detail；或真实输错密码 | 不进入工作台；可更正后登录 |
| G02 | 首次“无法连接工作台” | 目标身份GET发出前拦截`GET /api/auth/me/`503／断连；整页刷新会移除本脚本，冷启动可用DevTools请求阻止 | 重试入口；初次未登录401应进入登录页，不算连接故障 |
| G03 | “登录信息刷新失败，当前填写内容仍保留” | 已有工作台时，拦截身份GET503，执行`window.dispatchEvent(new Event('account-changed'))`触发重读 | 不清空输入，点重试恢复；合成事件同时显示核对账号通知，不证明真的换号 |
| G04 | 全局重新登录恢复提示 | D：当前业务请求401或403／`not_authenticated` | 原账号登录保留输入、恢复认证阻塞；不强制退出 |
| G05 | 安全校验失败 | D：403／`csrf_failed` | 草稿保留，原账号登录后重试 |
| G06 | 普通权限不足 | D：403仅带业务detail | 不误弹登录恢复，不改变权限，不自动退出 |
| G07 | “登录账号已变化，本次操作未执行” | UI演示：业务请求409／`account_changed`；真实隔离：B标签登录另一测试账号，A再写入 | 拒绝旧账号写入并重读身份；账号确实变化才关闭原工作台 |
| G08 | 退出登录失败 | `POST /api/auth/logout/`500／断连；先保存或明确放弃输入 | 显示退出错误，不假报已退出；E模式下服务器可能已注销，后续需登录 |
| G09 | 通用状态码报错 | http仅设置status测试默认提示；设置body测试后端字段／detail，不要沿用配方B的标题错误去验证所有状态码 | 区分校验、缺失、冲突、限流、服务器异常；写入5xx为结果未确认，不自动退出 |
| G10 | 响应格式异常／契约不完整 | 对来源概述、审核或快照等严格校验GET使用`invalid-json`或`json`＋`body:{}` | 报读取错误；不使用残缺结果。详情／概述、物料、27题、EMC、执行计划及现有审核／历史等入口会在缓存与使用前校验响应；不要以伪造200替代业务成功凭据 |
| G11 | CSRF获取失败，原写入未发送 | 仅清除当前站点`csrftoken`，拦截`GET /api/auth/csrf/`，再保存测试草稿 | 也能退出忙碌态；Network不应出现后续业务写入。测完原账号重新登录 |
| G12 | 重新登录前旧请求迟到 | H | 原GET可报状态已更新，不再重开全局恢复提示 |

### 4.2 读取失败与部分读取失败

默认A，注入后进入目标页或点刷新。首次失败和已有数据后的刷新失败各看一次即可，不必重复每个状态码。

| ID | 页面／目标GET | 错误表现与恢复入口 |
| --- | --- | --- |
| R01 | 工程变更列表：`/api/engineering-changes/` | 列表错误条、刷新列表 |
| R02 | 首次申请详情：`/api/changes/C/` | 无法读取申请类提示、重试／返回列表 |
| R03 | 已有详情的后续GET：同上 | “申请信息刷新失败，当前填写内容仍保留”，保留表单 |
| R04 | 物料：`/api/changes/C/materials/` | 列表错误＋重试，不冒充空列表成功 |
| R05 | 问题：`/api/changes/C/questions/` | 首次无法读取／已有内容刷新失败且保留，重试 |
| R06 | 本流程行动：`/api/changes/C/stage-workflow/` | 行动页错误＋重试，ECR/ECO相同组件 |
| R07 | ECO中来源评估：`/api/changes/C/ecr-actions/` | 无法读取ECR评估／保留内容的刷新失败，重试 |
| R08 | ECR中的ECO模板：`/api/changes/C/eco-actions/` | “ECO模板读取失败”，只重试，不生成任务 |
| R09 | EMC：`/api/changes/C/emc/` | 首次无法读取／已有填写保留的刷新失败，重试 |
| R10 | 执行计划：`/api/changes/C/execution-plan/` | 首次无法读取／已有填写保留的刷新失败，重试 |
| R11 | 实质性评估：`/api/changes/C/significant-change/` | 首次无法读取／已有填写保留的刷新失败，重试 |
| R12 | 流程进度：`/api/changes/C/stage-navigation/` | 卡片错误、“刷新进度” |
| R13 | 来源ECR发布概述：`/api/changes/C/source-ecr/` | 卡片错误、“重试读取来源” |
| R14 | 待我处理：`/api/review/` | 当前分类错误，顶部刷新列表 |
| R15 | 待我发布／已发布：`/api/publications/` | 发布分类错误，顶部刷新列表 |
| R16 | 审核轮次：`/api/changes/C/review-rounds/R/` | “审核记录读取失败”＋重试 |
| R17 | 历史表单：`/api/changes/C/review-rounds/R/form-snapshot/` | 展开时读取错误＋重试 |
| R18 | 同上，合法响应快照为空 | F：显示“本轮未保存完整历史表单”，不替换为当前正文 |
| R19 | 名单：`/api/action-owners/` | 分配抽屉名单错误；提交页“人员名单读取失败”；生成用例处重新加载；部分来源表单可显示“负责人名单读取失败” |
| R20 | 发布区：`/api/changes/C/publication/` | 卡片错误，查询发布与创建结果／刷新发布状态 |
| R21 | ECO填写人：`/api/changes/C/eco-filler/` | 卡片错误，刷新填写人；交接目标名单可重试读取 |
| R22 | 已提交后的提交页人员摘要：`/publication/`或`/review-rounds/R/` | “人员摘要读取失败，已选账号仍保留”＋“重试读取人员” |

定位：[物料](../../frontend/src/MaterialEditor.tsx)、[问题](../../frontend/src/QuestionEditor.tsx)、[EMC](../../frontend/src/EmcEditor.tsx)、[执行计划](../../frontend/src/ExecutionPlanEditor.tsx)、[实质性评估](../../frontend/src/SignificantChangeEditor.tsx)、[进度与来源](../../frontend/src/StageNavigation.tsx)、[待我处理](../../frontend/src/ReviewWorkbench.tsx)、[审核](../../frontend/src/ReviewPanel.tsx)、[历史](../../frontend/src/RoundSnapshotForm.tsx)。

### 4.3 保存、创建与删除失败

默认B或C。输入先满足本地校验，否则不会发请求。多数是表单内Alert和保存状态，不是独立Modal。

| ID | 页面／写接口 | 操作与预期 |
| --- | --- | --- |
| W01 | 概述：`PATCH /api/changes/C/` | 修改标题；“保存失败，填写内容仍保留”，不得回退或假报已保存 |
| W02 | 新物料：`POST /api/changes/C/materials/` | 首次手动保存失败，抽屉和输入保留；原抽屉以原标识重试，不重复创建 |
| W03 | 已有物料及处置：`PATCH /api/changes/C/materials/M/` | 修改物料／某处置备注，失败保留输入及其他位置，恢复后手动保存 |
| W04 | 27题／批量回答：`PATCH /api/changes/C/questions/` | 答案或批量全是／全否失败，保留答案和备注；没有独立批量失败Modal |
| W05 | 分配：`PATCH /api/changes/C/ecr-actions/行动ID/`或`eco-actions/行动ID/` | 修改负责人／补充项，抽屉保存错误，不能假报分配成功 |
| W06 | 任务结果：`PATCH /api/changes/C/action-tasks/T/` | 结果、状态和日期保留；保存失败不等于确认失败。原保存请求有独立回执逻辑，不是确认区unknown |
| W07 | EMC：`PATCH /api/changes/C/emc/` | 改标记／说明，主表或抽屉“保存失败，填写内容仍保留” |
| W08 | 执行计划：`PATCH /api/changes/C/execution-plan/` | 日期合法后改责任人／备注；保存失败不丢其他行 |
| W09 | 实质性评估：`PATCH /api/changes/C/significant-change/` | 修改回答／人工结论，主表和子表保存失败提示 |
| W10 | 提交页人员配置：`PATCH /api/changes/C/` | 选择发布人／批准人后失败，保存错误与“重试保存发布人”；未保存／在途不能提交 |
| W11 | 新建ECR：`POST /api/changes/` | 列表区创建错误；没有统一的原UUID恢复三按钮，不应虚构 |
| W12 | 删除物料：`DELETE /api/changes/C/materials/M/` | 确认后注入，显示“删除失败”；E会真实删除，恢复后必须核对列表，不能仅凭报错认定仍在 |
| W13 | 整项删除：`DELETE /api/changes/C/` | 测试工程中确认后注入，对话框／列表报错；404会刷新并提示不存在或不可访问；没有统一的删除结果查询区 |
| W14 | 生成测试用例：`POST /api/test-cases/` | 生成弹窗内错误及相同选择重试说明；保持弹窗和原选择重试，避免改选择产生新请求 |

定位：[队列](../../frontend/src/autosave.ts)、[任务保存回执](../../frontend/src/ecrStage.ts)、[删除](../../frontend/src/DeleteEngineeringChangeDialog.tsx)、[生成用例](../../frontend/src/TestCaseGenerator.tsx)。

### 4.4 操作结果未确认

区分未发送的network／timeout／500与E“实际执行后丢失回包”，它们的查询预期不同。需业务权限和可操作的测试状态；伪造200不等于成功回执验证。

| ID | 目标POST及前置条件 | 异常区和恢复 |
| --- | --- | --- |
| U01 | `/api/changes/C/action-tasks/T/`；本人任务填写完整且未确认 | “确认结果未确认，原请求已保留”；查询结果、按原请求重试、重新登录。确认前先PATCH保存，规则只匹配POST |
| U02 | `/api/changes/C/stage-submission/`；可提交草稿／修订 | “提交结果未确认，原UUID已保留”；查询结果、按原请求重试、原账号重新登录 |
| U03 | `/api/changes/C/review-rounds/R/approve/`；有批准权限且条件满足 | 审核意见抽屉“操作结果未确认……”；查询结果、按原请求重试。故障会打开意见抽屉 |
| U04 | 同轮`return/`；退回权限＋完整清单 | 同上，清单保留，原请求不能变为另一批意见 |
| U05 | 同轮`respond/`；申请者回应现有意见 | 同上，文字和原版本保留 |
| U06 | 同轮`resolve/`；原提出者复核解决 | 同上，不以别人操作或相似文字误确认原请求 |
| U07 | `/api/changes/C/publication/`；已批准、指定发布人 | 发布区未知提示；查询发布结果、原请求重试、原账号登录 |
| U08 | `/api/changes/C/eco/`；已发布ECR、有创建权限且尚未关联 | 创建未知恢复；迟到的旧响应不得清掉已有创建回执；另一操作已创建ECO时结束不可重试状态并提示核对，不冒认原请求成功、不覆盖草稿 |
| U09 | `/api/changes/C/eco-filler/`；有交接权限和有效目标 | “交接结果未确认……”；查询交接结果、原请求重试、原账号登录；可能自动用回执确认 |
| U10 | `/api/system-feedback/`、`/api/system-feedback/F/followups/`、`/api/system-feedback/manage/F/actions/` | 新建／追加／管理分别测试；“操作结果未确认，原请求和输入已保留”，查询与原请求重试 |

查询接口：任务／提交用`GET /api/changes/C/stage-workflow/`；正式审核用`GET /api/changes/C/review-rounds/R/`；发布／创建用`GET /api/changes/C/publication/`；交接先查`GET /api/changes/C/eco-filler/requests/原UUID/`再读人员分配；系统反馈查`/api/system-feedback/requests/原UUID/`、`/api/system-feedback/F/requests/原UUID/`或`/api/system-feedback/manage/F/requests/原UUID/`。

系统反馈查原请求404会显示“尚未查到原请求，结果仍未确认”，不假报未执行。物料创建和生成用例不使用这组统一查询路径。

来源：[行动与提交](../../frontend/src/StageWorkflow.tsx)、[审核](../../frontend/src/ReviewPanel.tsx)、[发布](../../frontend/src/PublicationPanel.tsx)、[交接](../../frontend/src/EcoFillerPanel.tsx)、[反馈](../../frontend/src/SystemFeedbackPanel.tsx)。

### 4.5 消息、已读及系统反馈局部异常

| ID | 触发 | 应出现的处理 |
| --- | --- | --- |
| N01 | A：`GET /api/review/inbox/` | “审核消息读取失败”、刷新消息，不把旧消息当已读 |
| N02 | B／C：`POST /api/review/inbox/read/` | “已读标记未确认，请刷新消息后重试”；不执行业务 |
| N03 | 已缓存未读消息，只令上面GET失败，再真实点击标已读，POST正常 | “已读已保存，但列表刷新失败……”；可能另有读取错误。不是标已读失败 |
| N04 | A：`GET /api/eco-filler/inbox/`；B：其`read/`POST | “ECO填写提醒读取失败／重试提醒”；标已读失败以消息警告并重读 |
| N05 | A：`GET /api/system-feedback/inbox/` | “反馈提醒读取失败／重试”；列表消息列显示读取失败，不假报无未读 |
| N06 | A：`GET /api/system-feedback/`或`manage/`列表 | 列表错误＋重试，不重置已有输入 |
| N07 | A：`GET /api/system-feedback/F/`或`manage/F/` | “读取失败，当前输入仍保留”，不当作空反馈 |
| N08 | B：`POST /api/system-feedback/inbox/read/` | 消息警告，重新读详情和提醒，不执行管理动作 |

来源：[审核消息](../../frontend/src/ReviewInbox.tsx)、[填写提醒](../../frontend/src/EcoFillerInbox.tsx)、[反馈](../../frontend/src/SystemFeedbackPanel.tsx)。

### 4.6 版本、权限、轮次变化

这组不能只靠假的409证明，需让后续成功GET带回新状态。UI演示与后端真实授权测试分开记录。

| ID | 准备与触发 | 应保护的内容／提示 |
| --- | --- | --- |
| C01 | 意见有未发送回应，再用G | “意见已更新，未发送文字保留；请核对最新记录，清除后重新填写” |
| C02 | 反馈有回复／追加草稿，第二测试账号实际追加或处理，第一页刷新 | “反馈已有更新／已被其他操作更新，文字仍保留……”；不能以旧版本发送。UI覆写须提供完整事件链 |
| C03 | 管理员有草稿时真实撤销其测试管理组；或管理请求403／`feedback_permission_changed`并对身份GET覆写`can_manage_feedback:false` | “反馈管理权限已取消”；清理管理读取缓存，保留文字可复制；未知操作可能已执行 |
| C04 | 参与者有脏输入，另一授权测试会话退回当前轮，前页读最新轮次 | “正文权限已收回，未保存输入和未确认操作暂时保留”；不开放正在修订正文 |
| C05 | U01未知后，另一有权会话推进／确认任务或产生新轮，再查询 | 已是原请求则确认；否则“任务状态、轮次或版本已变化……”；不无限锁页 |
| C06 | U02未知后，另一授权会话提交／改变阶段，再查询 | 识别原UUID；不能重试时提示阶段／轮次变化，不盲目再提交 |
| C07 | U03–U06未知后，其他参与者使轮次终结、意见版本／权限改变，再查询 | “当前状态已变化，原请求不能继续执行；未发送文字仍保留……” |
| C08 | 有回应草稿或退回清单，测试会话使相关权限消失，再刷新 | “以下文字尚未发送，可复制后保留”或“本轮不能再退回，以下意见尚未提交” |
| C09 | 自己的测试ECO交接填写人，旧填写人再保存 | 拒绝旧职责写入；交接确认后可返回列表，已有正文和历史不被重试覆盖 |

协作测试需两个不同且有业务授权的测试账号／独立浏览器会话。同账号新登录会替换旧会话；同浏览器标签换号适合G07，不是两个独立参与者。无需停数据库。

### 4.7 未保存输入与忙碌保护

属于条件保护，不是服务故障。直接编辑，或用B/C让保存失败／挂起后操作。

| ID | 方法 | 预期 |
| --- | --- | --- |
| P01 | 当前表单PATCH持续400，输入后切左侧页签 | “切换前有未保存的修改”：继续填写／放弃并切换／保存并切换 |
| P02 | P01选择保存并切换，故障仍开 | 留在当前页、编辑器报保存错误；解除后再次保存切换 |
| P03 | 物料／行动分配有未保存输入，关闭抽屉 | “放弃未保存的物料修改？”／“放弃未保存的输入？”；取消保留 |
| P04 | 表单脏时返回列表、切工作区或退出；提交页未提交选择离开 | “离开前放弃未保存的修改？”／“离开未提交的审核选择？”；确认放弃才离开 |
| P05 | 脏输入后按浏览器刷新／关闭 | 浏览器原生离开提醒，需要真实交互，文字由浏览器决定；不承诺项目自定义文案 |
| P06 | 系统反馈或正式意见有未发送文字，切模式／另一抽屉／返回待我处理 | 放弃反馈、保留并切换、未保存任务／意见离开确认；取消不能丢文字 |
| P07 | U类未知结果时尝试关闭、切申请、重复操作 | 部分控件禁用；反馈可提示“请先查询结果或按原请求重试”；跳转可提示先确认当前操作结果 |

来源：[保存并切换](../../frontend/src/SaveBeforeSwitch.tsx)、[App保护](../../frontend/src/App.tsx)、[物料](../../frontend/src/MaterialEditor.tsx)、[行动](../../frontend/src/StageWorkflow.tsx)、[反馈](../../frontend/src/SystemFeedbackPanel.tsx)。

### 4.8 输入校验与业务阻断

不必伪造网络，直接构造自己的测试输入。这些不是断网弹窗，但属于异常／不满足条件提示。

| ID | 输入／操作 | 预期 |
| --- | --- | --- |
| V01 | 概述日期不完整，或用工具构造超长短文本后校验 | 日期／长度错误，保存不发送，输入保留；普通键入可能被maxLength先限制 |
| V02 | 执行计划结束早于开始，或日期不完整 | 行内日期提示＋“请修正标注行的日期后保存”，其他行保留 |
| V03 | 任务结果／状态／日期不全，或ECO选在实施阶段完成 | 确认禁用；ECO可保存但不能确认，不靠伪造成功绕过 |
| V04 | 提交缺批准人、发布人、有效负责人、27题未答完；零行动未确认 | 各自缺人／问题／行动提示，提交禁用；标题和本阶段编号还受后端检查 |
| V05 | 批准前有未解决意见、未确认任务、未提交修改意见 | 暂不能批准及具体原因；满足条件才可批准 |
| V06 | 实质性评估已有人工结论后，改变影响结论的回答／适用性 | “回答已调整，请核对组结论及最终结论”，不自动生成替代结论 |
| V07 | 反馈留空、退回清单空意见、交接未选目标 | 相应按钮禁用；不能强行越过禁用去“测试网络错误” |

## 5. 不要误算为异常

- 提交、确认任务、发布、启动ECO、交接、删除的首次确认：正常业务确认，故障在确认后才作用于请求。
- “你有N项未读审核消息”：正常提醒。
- 已锁定／来源只读／已发布：正常业务状态，不等于系统故障。
- `?preview=ecr`布局演示：只用页面内存、不调正式业务接口，网络注入不会触发其模拟保存；演示确认不能证明真实申请恢复。
- 来源ECR评估编辑器有保存／脏输入离开分支，但当前生产调用强制发布态只读，不能当作普通可编辑行动测试。正式ECR/ECO行动使用`StageWorkflow`。有源码提示不等于当前页面可达。

## 6. 自动化优先与人工抽查

日常先运行[测试说明](README.md)中的自动化命令。新增fault-injection测试直接运行真实注入脚本并调用实际API错误分类；response-safety验证不完整读取不污染缓存、异常保存不清掉输入；既有领域测试覆盖权限、幂等、轮次、版本和未知结果恢复。后端测试在独立MySQL测试库运行，不操作开发库。

| 场景组 | 自动化核对重点 | 人工抽查边界 |
| --- | --- | --- |
| G：身份与HTTP | api、autosave、test_api_errors及真实CSRF／账号绑定测试 | 实际浏览器会话替换／重新登录交互 |
| R／W：读写故障 | response-safety、material-save、question-draft、execution-plan、significant-change、autosave及对应后端测试 | 页面视觉位置、输入法和浏览器原生提醒 |
| U／C：未知结果与并发 | ecr-recovery、eco-stage、review、publication、eco-filler、system-feedback及后端事务／并发测试 | 真实网络代理与多设备中断环境 |
| N／P／V：消息、保护、校验 | review-inbox、system-feedback、date-validation、保存队列和后端业务规则 | 完整业务流程的用户验收 |

无需用户逐页注入全部错误，也无需为ECR／ECO共用组件重复跑所有状态码。需要人工复核时，每类选一个代表场景；记录场景ID、方法＋URL＋mode、实际显示和恢复结果。涉及写入核对request_id、轮次及记录数，不保存Cookie、CSRF或密码。

脚本仅供独立DevTools调试，不被前端导入；不增加产品故障按钮、公开调试接口或权限后门。执行结果和未覆盖边界统一记入[测试说明](README.md)，不把源码核对写成逐项浏览器通过。

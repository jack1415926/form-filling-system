# 人工反馈第五批：ECO概述的来源ECR编号（2026-10-13）

仅处理一起看的批注9、10。ECO概述的来源编号控件原先绑定本实例的ecr_no，而该字段按当前规则必须为空；实际来源编号由source_ecr_no返回，所以顶部关联有值、概述却为空。

App.tsx现将该控件作为未绑定保存字段的只读展示，直接使用source_ecr_no。ECR的编号输入保持可编辑，ECO自身编号保持独立填写。没有将来源编号复制进ECO.ecr_no或保存队列，也不改变后端与数据库规则。

ESLint及TypeScript／Vite构建通过。真实React页面配合完全模拟API的独立浏览器核验ECR／ECO概述：来源ECR-900正确显示且只读；初次打开没有自动保存请求；修改标题仅提交title，修改ECO编号仅提交eco_no，来源编号始终显示且不进入PATCH，ECO.ecr_no仍为空，无pageerror。证据在.local/manual-source-number-batch5，没有写开发库或使用真实登录会话。

人工复验：刷新localhost:5173，打开有来源的ECO概述，核对来源编号与顶部关联一致、不能修改；ECO编号仍单独填写。本项待用户复验，本批到此停止。

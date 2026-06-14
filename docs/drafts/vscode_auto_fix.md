IDE Action Context

感知用户光标选中所在文本的状态，如果是 Diagnostic(错误/警告) 的地方，小灯泡那里会出现:

- `Pi: Fix it`: 用户点击后，将所有诊断信息发送到 Pi，Pi 端接收到诊断信息后，自动触发 Debug 流程，进行问题分析和修复意见

触发 Fix 会话的Prompt 内部有一个模板，然后也可以让用户进行自定义

参考 Prompt 模板：

<!-- Diagnostic Context -->

{Diagnostic_Context}

<!-- Diagnostic Context -->

Analyze the errors and warnings that appear in the above locations and provide recommendations for resolution.

- `Pi: Send diagnostic`: 用户点击后，发送诊断信息，然后将内容发送到输入框，交由用户自行调整添加 Prompt 后发送消息

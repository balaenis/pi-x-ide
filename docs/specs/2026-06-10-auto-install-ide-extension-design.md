# IDE Extension Auto-install Design

## Summary

当 Pi 在 VS Code、Cursor、Windsurf 等 VS Code 体系的集成终端中启动时，Pi x IDE 应尝试自动确保对应 IDE 已安装 `balaenis.pi-x-ide` 扩展。安装检测与安装过程必须异步执行，不能阻塞 Pi 启动。安装或更新成功后，Pi 应自动重试 IDE 连接，使用户无需手动完成扩展安装与连接流程。

本设计采用 Marketplace/Open VSX 扩展 ID 作为安装来源：

```bash
<ide-cli> --install-extension balaenis.pi-x-ide
```

不在本阶段内置或分发 `.vsix` 文件。原草稿中的 “VSIX” 只作为历史命名，正式功能名称为 “IDE extension auto-install”。

## Goals

- 在 Pi 启动时异步检测并安装或更新 IDE 扩展，不阻塞 `session_start`。
- 默认启用自动安装，并提供环境变量关闭能力。
- 安装完成后自动重试 IDE 连接，尽量达成 “启动 Pi 后自动连上 IDE”。
- 支持 `/ide install` 手动选择目标 IDE 并安装扩展。
- 支持 VS Code、Cursor、Windsurf 这类兼容 VS Code CLI 扩展管理参数的 IDE。
- 通过版本检测避免重复安装：未安装或已安装版本低于 Pi 包内置目标版本时才安装。

## Non-goals

- 不在本阶段打包、内置或 fallback 到 `.vsix`。
- 不实现 Zed 或非 VS Code 扩展体系 IDE 的安装流程。
- 不强制重启或 reload 用户的 IDE。
- 不覆盖用户已手动关闭的 IDE 集成连接状态。
- 不在自动安装阶段向用户展示阻塞式选择器。

## Constraints and Assumptions

- 当前仓库中 Pi 端通过 `~/.pi/pi-x-ide/*.lock` 发现已运行的 IDE 扩展；如果扩展尚未安装，则不会有 lock file 可发现。
- `vscode/package.json` 中扩展 ID 为 `balaenis.pi-x-ide`，当前版本与根 `package.json` 版本保持一致。
- 发布后的 Pi npm 包不应依赖 `vscode/` 源目录存在，因此目标版本应来自根包版本或构建期生成的常量，而不是运行时读取 `vscode/package.json`。
- VS Code 官方 CLI 支持：

```bash
code --list-extensions --show-versions
code --install-extension (<extension-id> | <extension-vsix-path>)
```

- Cursor、Windsurf 应仅在本机 CLI 存在且支持同类参数时纳入候选。
- 新安装的扩展不一定会在已运行 IDE 中立即激活；如果重试后仍无 lock file，应提示用户 reload IDE 或手动运行 `/ide install`。

## Recommended Approach

### Startup flow

`session_start` 时拆成两个并行路径：

1. 保持现有行为：立即执行 `connectAuto()`，尝试连接已有 lock file。
2. 异步执行 `ensureIdeExtensionInstalled()`：
   - 检测是否允许自动安装。
   - 推断当前 Pi 是否运行在支持的 IDE 集成终端中。
   - 检查目标 IDE CLI 是否可用且支持扩展管理参数。
   - 通过 `--list-extensions --show-versions` 获取已安装版本。
   - 未安装或版本低于目标版本时，执行安装或更新。
   - 安装成功后触发有限次数的 lock file 发现与 `connectAuto()` 重试。

自动安装流程必须 fire-and-forget，不改变 Pi 启动关键路径。错误以 UI notification 或状态消息呈现，不应导致 Pi 启动失败。

### Install source

统一使用扩展 ID：

```bash
balaenis.pi-x-ide
```

安装命令：

```bash
<ide-cli> --force --install-extension balaenis.pi-x-ide
```

`--force` 只在需要安装或更新时使用，用于确保已安装但版本较旧时能更新到可用版本。

### Disable switch

新增环境变量：

```bash
PI_X_IDE_AUTO_INSTALL=0
```

取值建议：

- `0`、`false`、`off`：禁用自动安装。
- 未设置或其他值：启用自动安装。

该变量只控制扩展安装尝试，不控制现有 IDE 连接能力。用户仍可通过 `/ide auto`、`/ide off` 管理连接状态。

## Detailed Design

### Candidate model

新增内部安装候选类型：

```ts
interface IdeInstallCandidate {
  id: "vscode" | "cursor" | "windsurf";
  label: string;
  cli: "code" | "cursor" | "windsurf";
  cliPath: string;
  confidence: "current-terminal" | "running-process" | "available-cli";
  installedVersion?: string;
  targetVersion: string;
  needsInstall: boolean;
  reason: "missing" | "outdated" | "current" | "unknown";
}
```

候选来源分三层：

1. **当前集成终端信号**：优先使用环境变量或父进程信息判断当前 Pi 是否从某个 IDE 终端启动。
2. **运行中的 IDE 进程**：如果能安全地识别 VS Code/Cursor/Windsurf 进程，可作为手动安装候选。
3. **可用 CLI**：`code`、`cursor`、`windsurf` 命令存在且支持扩展参数时，可作为 `/ide install` 候选。

自动安装只应使用高置信候选，例如 `current-terminal`。如果只有多个低置信 CLI 候选，自动安装应跳过，提示用户使用 `/ide install` 手动选择，避免安装到错误 IDE。

### Version detection

对每个候选执行：

```bash
<ide-cli> --list-extensions --show-versions
```

解析形如：

```text
balaenis.pi-x-ide@1.0.5
```

比较规则：

- 未出现 `balaenis.pi-x-ide`：需要安装。
- 已安装版本低于目标版本：需要更新。
- 已安装版本等于或高于目标版本：跳过安装。
- 版本无法解析：自动安装阶段保守跳过或记录 warning；手动安装阶段允许用户确认后使用 `--force`。

目标版本应与发布包版本一致。实现时推荐从根包版本或构建期常量读取，避免发布包中缺少 `vscode/package.json` 导致运行时失败。

### Install execution

安装命令：

```bash
<ide-cli> --force --install-extension balaenis.pi-x-ide
```

执行约束：

- 使用 `spawn` / `execFile`，不要通过 shell 拼接命令。
- 设置合理超时，例如 60 秒。
- 捕获 stdout / stderr，用于失败提示与调试。
- 同一 Pi runtime 中同一目标 IDE 只允许一个安装任务同时运行。
- 自动安装失败不影响现有连接重试逻辑。

### Connection retry after install

安装成功后，执行有限重试：

1. 每隔 1-2 秒重新扫描 lock file。
2. 找到匹配候选后调用现有 `connectAuto()`。
3. 最多重试 10-15 秒。
4. 超时仍未发现 lock file 时提示：扩展已安装，但 IDE 可能需要 reload。

建议提示文案：

```text
Pi x IDE extension installed for VS Code. If Pi does not connect automatically, reload the IDE window and run /ide auto.
```

### `/ide install` command

扩展 `/ide` 子命令：

```text
/ide install
```

行为：

1. 构建 VS Code/Cursor/Windsurf 安装候选列表。
2. 对每个候选展示：IDE 名称、CLI 路径、已安装版本、目标版本、是否需要安装。
3. 如果只有一个候选，可以直接询问确认或直接安装。
4. 如果多个候选，使用 TUI select 让用户选择。
5. 安装成功后重试连接。

示例列表：

```text
1. VS Code — installed 1.0.4, target 1.0.5, update required
2. Cursor — not installed, target 1.0.5
3. Windsurf — installed 1.0.5, up to date
```

如果用户选择已是最新版本的 IDE，应提示无需安装，并可继续触发一次 `connectAuto()`。

### UI and notification behavior

自动安装阶段应保持低打扰：

- 开始安装时可显示 info：正在为当前 IDE 安装 Pi x IDE 扩展。
- 成功后显示 info：安装完成，正在尝试连接。
- 失败后显示 warning：包含目标 IDE 与简短失败原因。
- 不在 startup 自动流程中弹出选择器。

手动 `/ide install` 可以使用选择器和更详细的结果通知。

## Data and Interfaces

### New environment variable

```text
PI_X_IDE_AUTO_INSTALL
```

### New command

```text
/ide install
```

`/ide` completion 应新增 `install`：

```text
status | list | auto | off | attach | install
```

### New internal modules

建议新增：

```text
src/pi/install.ts
```

职责：

- CLI 发现与 capability 检测。
- 已安装扩展版本解析。
- 版本比较。
- 安装执行。
- 自动安装候选选择。

`src/pi/index.ts` 负责在 `session_start` 中调度自动安装，并在安装成功后调用现有连接动作。

## Error Handling and Edge Cases

| 场景                                    | 处理                                            |
| --------------------------------------- | ----------------------------------------------- |
| 未找到任何支持的 IDE CLI                | 自动安装静默跳过；`/ide install` 显示 warning。 |
| 多个 IDE CLI 可用但无法判断当前终端来源 | 自动安装跳过，提示用户使用 `/ide install`。     |
| `--list-extensions` 失败                | 自动安装跳过该候选；手动命令显示失败原因。      |
| Marketplace/Open VSX 网络失败           | 显示 warning，不影响 Pi 启动与已有连接。        |
| 扩展安装成功但未生成 lock file          | 有限重试后提示 reload IDE。                     |
| 已安装版本高于目标版本                  | 不降级，视为 up to date。                       |
| 用户设置 `PI_X_IDE_AUTO_INSTALL=0`      | 不执行自动安装，但手动 `/ide install` 仍可用。  |
| 用户执行 `/ide off`                     | 只关闭连接集成；不应触发自动安装后的强制连接。  |

## Alternatives Considered

### 1. Bundled VSIX

将 `.vsix` 打入 Pi 包并执行：

```bash
<ide-cli> --install-extension ./pi-x-ide.vsix
```

优点：

- 可以离线安装。
- Pi 包与 IDE 扩展版本严格一致。

缺点：

- 增加 npm 包体积。
- 发布流程更复杂。
- 需要处理 VS Code Marketplace、Open VSX 和本地 VSIX 多来源一致性。

结论：本阶段不采用。

### 2. Hybrid fallback

先用 Marketplace/Open VSX，失败后 fallback 到 bundled VSIX。

优点：

- 鲁棒性最好。

缺点：

- 仍需承担 bundled VSIX 的发布和测试复杂度。
- 分支更多，错误提示更复杂。

结论：暂不采用，可作为未来增强。

### 3. 只提供手动 `/ide install`

优点：

- 实现简单，几乎没有误安装风险。

缺点：

- 不能达成 “在集成终端启动 Pi 后自动可用” 的核心体验。

结论：不作为主方案，但 `/ide install` 仍作为手动 fallback。

## Rollout or Migration

1. 新增安装模块和单元测试。
2. 在 `/ide` 命令中加入 `install` 子命令。
3. 在 `session_start` 中接入异步自动安装。
4. 发布前确认 `balaenis.pi-x-ide` 已在目标扩展市场可安装。
5. 更新 README 和 README.zh.md，说明自动安装、关闭环境变量和手动安装命令。

## Testing and Validation

### Unit tests

- 解析 `--list-extensions --show-versions` 输出。
- 比较版本：低于、等于、高于、预发布或无法解析。
- 根据环境变量判断 `PI_X_IDE_AUTO_INSTALL` 是否启用。
- 候选排序与自动安装候选选择。
- 安装命令参数生成，确保不通过 shell 拼接。

### Integration tests or manual validation

- 未安装扩展时，从 VS Code 集成终端启动 Pi，确认自动安装并连接。
- 已安装旧版本时，确认自动更新。
- 已安装当前版本时，确认不重复安装。
- 设置 `PI_X_IDE_AUTO_INSTALL=0` 时，确认不会自动安装。
- 多个 IDE CLI 存在但无法判断当前 IDE 时，确认不会自动选择错误目标。
- 执行 `/ide install`，确认可以选择 VS Code/Cursor/Windsurf 并安装。
- 安装成功但未自动连接时，确认提示用户 reload IDE。

## Open Questions

- Cursor 和 Windsurf 在不同平台上的 CLI 名称、扩展市场来源和 `--force` 行为是否与 VS Code 完全一致，需要实测确认。
- 是否需要在未来支持 `.vsix` fallback，以覆盖离线或扩展市场不可用的环境。
- 自动安装成功后是否需要提供一键 reload IDE 的提示；本阶段先只提示用户手动 reload。

# Effect 采用说明

Pi × IDE 在 Pi 侧把 [Effect](https://effect.website/) 当作**实现细节**，用于结构化失败、Schema 校验与可组合的异步流程。VS Code、测试与 Pi host 回调使用的公开 API 仍保持 Promise / 同步友好。本文面向改动 `src/shared/*` 或 `src/pi/*` 的贡献者。

## 为什么在这里用 Effect

- **结构化错误** — tagged 失败（如 `LockFileParseError`、连接 / 安装错误）携带字段，避免靠字符串解析。
- **Schema 解码** — lock file、selection、diagnostic 载荷共用校验路径（`effect-schema` → `schema.ts` 适配层）。
- **边界控制** — discovery、host resolve、install、connect、reconnect、Zed 轮询等 IO 可在进程边界 fail-closed 或 log-and-swallow。

Effect 不是产品功能，终端用户无需配置。

## 边界规则

- **禁止** 把 Effect 失败抛进 Pi host 回调或 VS Code activation。
- 在边界用 `Effect.runPromise` / `Effect.runSync`、Phase 1 runner（`runEffect` / `runEffectSync`）或 Pi 助手（`runPiEffect`）退出 Effect。
- Pi 边界失败时：经 `logExtensionError` / `containPiError` 记录；可选设置 `runtime.connectionStatus = "error"`。
- **中断**（reconnect / Zed poll fiber）视为取消，不是 UI error。

`authToken` 只出现在 WebSocket 升级头。不要把 token 或完整 lock JSON 写进日志、Effect 错误消息或 `scope` 字符串。

## 模块地图

| 模块                                                                             | 作用                                                                        |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/shared/effect-errors.ts`                                                    | `Data.TaggedError` 领域错误（可读 `message`）                               |
| `src/shared/effect-runtime.ts`                                                   | `runEffect` / `runEffectSync`（吞失败并打日志）；`runEffectOrThrow`（测试） |
| `src/shared/effect-schema.ts`                                                    | Effect Schema 定义与 `decode*`                                              |
| `src/shared/schema.ts`                                                           | 稳定的 `is*` / `parse*` 门面                                                |
| `src/shared/jsonrpc-guard.ts`                                                    | 无 Effect 的 `isJsonRpcRequest`，供 VS Code `ide-server` 依赖图使用         |
| `src/pi/index.ts`、`commands.ts`、`context.ts`、`ui.ts`、`state.ts`、`safety.ts` | 轻量静态壳：注册、状态 UI、错误收敛（无 Effect）                            |
| `src/pi/runtime-loader.ts`                                                       | 唯一动态边界：缓存的 `import("./runtime-services.js")`                      |
| `src/pi/runtime-services.ts`                                                     | 重型生命周期：discovery/install/connect/reconnect/Zed（可导入 Effect）      |
| `src/pi/effect-boundary.ts`                                                      | `runPiEffect` → `containPiError` + UI 状态（导入 Effect runtime）           |
| `src/pi/safety.ts`                                                               | 无 Effect 的 `containPiError`、`runPiBoundary`、`runPiBoundaryAsync`        |
| `src/pi/discovery.ts`、`ide-host.ts`、`install.ts`                               | Effect 程序 + Promise 门面                                                  |
| `src/pi/connection.ts`                                                           | 连接握手 Effect；tagged timeout 映射为 `IdeConnectionTimeoutError`          |
| `src/pi/reconnect.ts`、`zed.ts`                                                  | reconnect 延迟与 Zed 轮询的可中断 fiber                                     |

VS Code 仍通过 `@shared/*` 引入必须保持无 Effect 的路径（`jsonrpc-guard`、protocol、lock-file 辅助）。若把 `effect-schema` 拉进 VS Code 包体，属于 escape hatch 失败：解码应留在 Pi 侧，或在包体膨胀时拆分 guard。

### Pi 启动壳与重型 runtime

- 发布的 Pi 入口是 esbuild code-split ESM 壳（`dist/src/pi/index.js`），Effect / `ws` / `node:sqlite` 只出现在指向 lazy chunk 的 **dynamic-import** 边上。
- `runtime-loader.ts` 是唯一动态边界。`runtime-services.ts` 与 `effect-boundary.ts` 可导入 Effect；静态壳不得导入。
- 在静态壳中新增 Effect 或重型 runtime 的静态导入属于**启动回归**。bundler 的 metafile topology / size gate 会在静态入口出现重型静态依赖时让构建失败。

## 导入风格

优先 Effect 子路径导入以便 tree-shaking：

```ts
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Data from "effect/Data";
import * as Fiber from "effect/Fiber";
```

## 错误标记约定

- 使用 `effect-errors.ts` 中已有 tag（或在真正需要的 phase 再新增）。
- 覆盖 `message`，让默认日志可读，且不泄露密钥。
- 现有代码用 `instanceof` 检查的 Promise 门面（如 `IdeConnectionTimeoutError`）必须把 tagged 失败映射回这些 class。

## 仍保持 Promise / 同步的部分

- 导出的 discovery、install、connect、host-resolve 入口。
- `IdeConnection` 类方法与回调模型。
- VS Code extension activation 与共享 IDE WebSocket server。
- 纯函数：排序、版本比较、路径匹配、Zed snapshot SQL。

重型 runtime（`runtime-services.ts` 及其下游）的调用点应继续使用 Promise 门面，除非某条路径明确改用 `effect-boundary.ts` 中的 `runPiEffect`。轻量静态壳不得导入 `effect-boundary.ts` 或 Effect 模块。

## 非目标

- 用完整 `Layer` DI 重写扩展入口。
- 重写 JetBrains Kotlin / Neovim Lua。
- 强制把 `node:test` 换成 `@effect/vitest`。
- 变更 on-wire 协议或 lock-file JSON 形状。
- 为 Effect 演示增加 mock / 假数据路径。

## 相关

- [架构](architecture.md) — 进程角色与数据流。
- [发现机制](discovery.md) — lock 排序（行为不因 Effect 改变）。
- 实现计划：[effect-adoption-plan](../../plans/effect-adoption-plan/)。

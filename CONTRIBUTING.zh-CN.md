# 贡献 Pi × IDE

本指南介绍如何构建项目、本地测试各 IDE 集成以及发布流程。面向用户的使用说明见 [文档](README.zh-CN.md#文档)。

## 环境依赖

- Node.js ≥ 26
- bun ≥ 1.3（`packageManager` 声明为 `bun@1.3.14`）
- VS Code ≥ 1.120.0（仅 VS Code 扩展需要）
- Neovim ≥ 0.9（仅 Neovim 插件需要）
- JDK 21（仅 JetBrains 插件需要；Gradle 可自动下载 toolchain）

[mise](https://mise.jdx.dev/) 管理工具链。在仓库根目录运行 `mise install` 即可安装声明的版本。

## 安装与构建

```bash
git clone https://github.com/balaenis/pi-x-ide.git
cd pi-x-ide
mise run setup
mise run build
```

加载本地构建（无需全局安装）：

```bash
pi -e ./src/pi/index.ts
```

## 任务

所有构建与检查命令都定义为 `mise run` 任务（见 `.mise/tasks/`）：

| 命令                           | 说明                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `mise run build`               | 编译 Pi 侧 TypeScript -> `dist/` + Neovim sidecar -> `ide-plugins/nvim/bin/` + VS Code bundle -> `ide-plugins/vscode/out/` |
| `mise run typecheck`           | 类型检查（不产出文件）                                                                                                     |
| `mise run test`                | 编译 + 运行单元测试                                                                                                        |
| `mise run package:vsix`        | 打包 VS Code 扩展为 VSIX                                                                                                   |
| `mise run compile:jetbrains`   | 用 Gradle 编译并测试 JetBrains 插件                                                                                        |
| `mise run package:jetbrains`   | 将 JetBrains 插件打包为 `ide-plugins/jetbrains/build/distributions/` 下的 ZIP                                              |
| `mise run verify:jetbrains`    | 对配置的目标 IDE 运行 IntelliJ Plugin Verifier                                                                             |
| `mise run check:config-schema` | 验证 `schemas/config.json` 与配置注册表是否同步                                                                            |

## 本地测试 VS Code 扩展

### 方式一：F5 启动 Extension Development Host（推荐）

1. 用 VS Code 打开 **项目根目录**。
2. 进入 **Run and Debug** 面板（`Ctrl+Shift+D`）。
3. 选择 **Run Pi x IDE VS Code Extension**。
4. 按 **F5**：
   - preLaunchTask 会自动执行 `mise run build`。
   - 打开一个标题包含 `[Extension Development Host]` 的新 VS Code 窗口。

### 方式二：打包 VSIX 后安装

```bash
mise run package:vsix
cd ide-plugins/vscode && code --install-extension dist/pi-x-ide-$(node -p "require('./package.json').version").vsix
```

这样安装的扩展在所有 VS Code 窗口中运行，不依赖 F5 Extension Host。

### 验证扩展是否运行

```bash
ls -l ~/.pi/pi-x-ide/lock
```

应看到类似 `vscode-12345-48123.lock` 的文件。如果没有，在 VS Code 中执行 **Developer: Reload Window**。

## 本地测试 JetBrains 插件

运行 sandbox IDE：

```bash
cd ide-plugins/jetbrains
./gradlew runIde
```

构建可安装的插件 ZIP：

```bash
mise run package:jetbrains
```

ZIP 会输出到 `ide-plugins/jetbrains/build/distributions/`。Smoke test：在 sandbox IDE 中打开本仓库，从同一目录启动 `pi`，打开并选择一个本地文件中的文本，然后按 `Ctrl+Alt+K` 或运行 **Pi x IDE: Attach Selection**。Pi 应收到 `@relative/path#Lx-Ly` mention。

## 配置 schema

当你新增或修改需要通过 `~/.pi/config.json` 配置的 Pi 侧配置项或环境变量时，更新 `src/shared/config-options.ts` 中的注册表并重新生成 schema：

```bash
mise run generate:config-schema
```

然后验证是否同步：

```bash
mise run check:config-schema
```

## 发布

本项目使用 [Release Please](https://github.com/googleapis/release-please) 和 [Conventional Commits](https://www.conventionalcommits.org/) 来自动化版本管理和发布流程。详见 [RELEASE.md](RELEASE.md)。

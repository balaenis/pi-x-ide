# TODO

diffTool 控制 Claude Code 修改文件时，diff 对比在哪里显示。

### 类型定义（src/utils/config.ts:179）

```typescript
export type DiffTool = "terminal" | "auto";
```

### 两种模式

┌────────────────┬───────────────────────────────────────────────────────────────────────────────────────────────────┐  
 │ 值 │ 行为 │  
 ├────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤  
 │ 'terminal' │ diff 始终在终端内渲染显示 │  
 ├────────────────┼───────────────────────────────────────────────────────────────────────────────────────────────────┤  
 │ 'auto'（默认） │ 如果已连接到安装了 Claude Code 扩展的 IDE，则在 IDE 的原生 diff 编辑器中打开 diff；否则回退到终端 │  
 └────────────────┴───────────────────────────────────────────────────────────────────────────────────────────────────┘

### 核心实现（src/hooks/useDiffInIDE.ts）

```typescript
const shouldShowDiffInIDE =
  hasAccessToIDEExtensionDiffFeature(toolUseContext.options.mcpClients) &&
  getGlobalConfig().diffTool === "auto" &&
  !filePath.endsWith(".ipynb");
```

当条件满足时，通过 MCP RPC 调用 openDiff 在 IDE 中打开一个 diff 标签页：

- 用户可以在 IDE 中 可视化审查 Claude Code 的修改（类似 Git diff 视图）
- 保存标签页 → 接受修改
- 关闭标签页不保存 → 拒绝修改
- IDE 中也可以直接手工编辑文件的改动内容

### 为什么 IDE 扩展安装后自动设置为 'auto'

在 maybeInstallIDEExtension()（ide.ts:599-602）中：

```typescript
if (!globalConfig.diffTool) {
  saveGlobalConfig((current) => ({ ...current, diffTool: "auto" }));
}
```

逻辑是：既然已经装了 IDE 扩展，就应该把 diff 默认导向 IDE——在 IDE 里看 diff 体验远好于终端。只在首次设置（diffTool 为空）时才自动写入，不会覆盖用户已经手动设过的值。

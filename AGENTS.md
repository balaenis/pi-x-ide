# Instructions

## Dev Tools

Prefer using `mise` as the development environment management tool.

- Common commands:
  - `mise run setup`
  - `mise run build`
  - `mise run lint`
  - `mise run typecheck`
  - `mise run test`
  - More task details can be found in `./mise/tasks`, or by running `mise tasks ls`
- When writing github/workflows workflows, please prefer using `mise` instead of `bun` or anything else.

## Dependency packages

- When the feature you’re building needs other dependencies, always use the latest stable version:

For `package.json`:

```json
"typescript": "{find the latest version}"
```

For `github/workflows`:

```yaml
- uses: actions/checkout@{find the latest version}
```

## Update documentation

User-facing documentation is organized by the [Diátaxis](https://diataxis.fr/) framework and lives under `docs/`:

- `docs/tutorials/` - learning-oriented walkthroughs
- `docs/how-to/` - task-oriented guides (install, WSL2, troubleshooting)
- `docs/reference/` - commands, configuration, feature parity, protocol
- `docs/explanation/` - discovery and architecture

When you add new features or make changes that require users to know some important details, please update the relevant English docs and keep the Chinese mirror in sync. Files that must stay in sync:

- `@README.md` ↔ `@README.zh-CN.md`
- `@CONTRIBUTING.md` ↔ `@CONTRIBUTING.zh-CN.md`
- `docs/{tutorials,how-to,reference,explanation}/*.md` ↔ `docs/zh-CN/{tutorials,how-to,reference,explanation}/*.md`

The `docs/zh-CN/` tree mirrors the English `docs/` structure. When adding a new English doc, create its counterpart under `docs/zh-CN/` in the same change. Note that relative links to repo-root assets (`schemas/`, `config.example.json`) and `docs/specs/` use one more `../` level from `docs/zh-CN/`.

## Update config schema

When the project adds new configuration options or environment variables that should be configurable through `~/.pi/config.json`, update the registry in `src/shared/config-options.ts` and regenerate `schemas/config.json` with `mise run generate:config-schema` in the same change.

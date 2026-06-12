# Instructions

## Dev Tools

Prefer using `mise` as the development environment management tool.

```bash
mise run setup
mise run build
mise run lint
mise run typecheck
mise run test
# ...More
```

## Dependency packages

- When the feature you’re building needs other dependencies, always use the latest stable version

## Update `README.md`

When you add new features or make changes that require users to know some important details, please update `@README.md` and sync the other language versions:

- `@README.zh-CN.md`

## Update config schema

When the project adds new configuration options or environment variables that should be configurable through `~/.pi/config.json`, update the registry in `src/shared/config-options.ts` and regenerate `schemas/config.json` with `bun run generate:config-schema` in the same change.

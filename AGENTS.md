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

When you add new features or make changes that require users to be aware of certain important details, please update the relevant sections in the README and make corresponding changes to the Chinese version of the README as well.

## Update `schemas/config.json`

When the project adds new configuration options or environment variables that should be configurable through `~/.pi/config.json`, update `schemas/config.json` in the same change.

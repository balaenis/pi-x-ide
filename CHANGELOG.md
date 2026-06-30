# Changelog

## [1.16.1](https://github.com/balaenis/pi-x-ide/compare/v1.16.0...v1.16.1) (2026-06-30)


### Bug Fixes

* **release:** update version marker for release-please ([351f71a](https://github.com/balaenis/pi-x-ide/commit/351f71adbf0e721d5d22ef57d30ad55270ff453b))

## [1.16.0](https://github.com/balaenis/pi-x-ide/compare/v1.15.2...v1.16.0) (2026-06-30)


### Features

* **pi:** render diagnostic-fix requests as custom TUI messages ([82d1821](https://github.com/balaenis/pi-x-ide/commit/82d18219cdfdfbb48689d6812db093396f229f4d))

## [1.15.2](https://github.com/balaenis/pi-x-ide/compare/v1.15.1...v1.15.2) (2026-06-29)


### Bug Fixes

* **pi:** resolve package version from package root ([9a5db66](https://github.com/balaenis/pi-x-ide/commit/9a5db66780b85203730825abfd5f95d24b2c3a87))

## [1.15.1](https://github.com/balaenis/pi-x-ide/compare/v1.15.0...v1.15.1) (2026-06-29)


### Bug Fixes

* **ui:** use grapheme-aware width for CJK-safe IDE status bar truncation ([9513960](https://github.com/balaenis/pi-x-ide/commit/95139605c36926be7e0ecb1553f823d3639a2b65))

## [1.15.0](https://github.com/balaenis/pi-x-ide/compare/v1.14.0...v1.15.0) (2026-06-23)


### Features

* **context:** wrap editor context in SELECTED_CONTEXT_MARKER for precise detection ([341e957](https://github.com/balaenis/pi-x-ide/commit/341e957e6f9ea32f60a90645f8fafa2e814bf267))

## [1.14.0](https://github.com/balaenis/pi-x-ide/compare/v1.13.1...v1.14.0) (2026-06-22)


### Features

* **jetbrains:** add JetBrains IDE plugin with lock-file, selection-tracking, and WebSocket server ([401e65d](https://github.com/balaenis/pi-x-ide/commit/401e65d50ed00f2803324c954560551f9ebe5c70)), closes [#47](https://github.com/balaenis/pi-x-ide/issues/47)
* **jetbrains:** add plugin icons, toolbar group, and icon references to actions ([ab5b0c4](https://github.com/balaenis/pi-x-ide/commit/ab5b0c483d004b2cc1d5950acbbdab9af8b9d9b6))
* **jetbrains:** add signing and publishPlugin support for JetBrains Marketplace ([d86f5e0](https://github.com/balaenis/pi-x-ide/commit/d86f5e0ec2769eeaec5a90b4c117c40d08e4df4e))
* **jetbrains:** run pi through login shell for proper PATH setup on native Unix and WSL ([7bf2924](https://github.com/balaenis/pi-x-ide/commit/7bf2924918692481c80a78fffd3ccffa67b166d3))
* **wsl:** add WSL-aware IDE discovery and cross-platform host resolution ([d8bd2e4](https://github.com/balaenis/pi-x-ide/commit/d8bd2e42687a79022a47337149169f03f1034b21))

## [1.13.1](https://github.com/balaenis/pi-x-ide/compare/v1.13.0...v1.13.1) (2026-06-20)

### Bug Fixes

- **vscode:** run pi through login shell in tmux terminal ([bee8563](https://github.com/balaenis/pi-x-ide/commit/bee8563bfde5623eb08d1db40260e50ea6ff2d94))

## [1.13.0](https://github.com/balaenis/pi-x-ide/compare/v1.12.0...v1.13.0) (2026-06-19)

### Features

- add error containment boundaries across all extension entry points ([064e725](https://github.com/balaenis/pi-x-ide/commit/064e72589f18979e57024166692627de7464edf0))

### Bug Fixes

- guard stale extension context callbacks ([316b1c1](https://github.com/balaenis/pi-x-ide/commit/316b1c1cea974229c8bef94a94d105b31cc76796))
- **pi:** guard stale connection callbacks and extension ctx errors ([094975c](https://github.com/balaenis/pi-x-ide/commit/094975c0081a48fb08ae226f4d8f64b5b38b5084))

## [1.12.0](https://github.com/balaenis/pi-x-ide/compare/v1.11.1...v1.12.0) (2026-06-16)

### Features

- **ui:** add animated spinner for connecting state ([ae82969](https://github.com/balaenis/pi-x-ide/commit/ae82969223f79c6ce28315337e846888738649aa))

## [1.11.1](https://github.com/balaenis/pi-x-ide/compare/v1.11.0...v1.11.1) (2026-06-15)

### Bug Fixes

- **ci:** Modify the rules guide and trigger once release pr ([f468f5a](https://github.com/balaenis/pi-x-ide/commit/f468f5ab8d61227b1d16faf2719f218a17829ecc))

## [1.11.0](https://github.com/balaenis/pi-x-ide/compare/v1.10.0...v1.11.0) (2026-06-14)

### Features

- **diagnostics:** send diagnostic context to one connected Pi client instead of broadcasting ([9681fd4](https://github.com/balaenis/pi-x-ide/commit/9681fd4dcf88aad1a43a5c1d002219a2477c5279))

### Bug Fixes

- **diagnostics:** escape primary context line marker to avoid markdown blockquote interpretation ([c2f005e](https://github.com/balaenis/pi-x-ide/commit/c2f005e8cd16c2743838d2e79d0ca0987a2e0a8d))

## [1.10.0](https://github.com/balaenis/pi-x-ide/compare/v1.9.0...v1.10.0) (2026-06-14)

### Features

- **diagnostics:** add configurable fix prompt for IDE diagnostics ([ca8621c](https://github.com/balaenis/pi-x-ide/commit/ca8621c6050c37ed921e20efcb4dd38907b1cbb9))
- **nvim:** verify sidecar binary against GitHub Release SHA-256 digest ([0cc1d9b](https://github.com/balaenis/pi-x-ide/commit/0cc1d9bf1ee5ef8f30d50374ffe68953c242d4ce))
- **vscode:** add Fix with Pi suggest quick action for diagnostics ([e8dc6d5](https://github.com/balaenis/pi-x-ide/commit/e8dc6d56543afb1d8019bcede0a540cacd440c6d))
- **vscode:** add Pi: Send diagnostic quick fix action ([d53d72b](https://github.com/balaenis/pi-x-ide/commit/d53d72bb1030f58da7f82136a75b95da2568f28a))
- **vscode:** hide pi terminal from user initially and show without stealing focus ([15ca612](https://github.com/balaenis/pi-x-ide/commit/15ca6121a4c25a1ed68cb6631372b5a100c77a7b))

### Bug Fixes

- **pi:** wrap diagnostic context message with marker on both sides ([592da42](https://github.com/balaenis/pi-x-ide/commit/592da424d16a190c958eac86a70045405e91e936))

## [1.9.0](https://github.com/balaenis/pi-x-ide/compare/v1.8.0...v1.9.0) (2026-06-13)

### Features

- **vscode:** add useTmux setting to open Pi through tmux ([93cec4d](https://github.com/balaenis/pi-x-ide/commit/93cec4de9f2f51312db4c3a4672b2f2ffe2ddc61))

### Bug Fixes

- **pi/install:** filter out unknown-reason candidates from auto-install ([375449b](https://github.com/balaenis/pi-x-ide/commit/375449b2306d8fa1098a30a0176eff9dc5f602e2))

## [1.8.0](https://github.com/balaenis/pi-x-ide/compare/v1.7.0...v1.8.0) (2026-06-12)

### Features

- **attach:** make TUI attach shortcut configurable via PI_X_IDE_ATTACH_SHORTCUT ([20a7e9c](https://github.com/balaenis/pi-x-ide/commit/20a7e9c80644d4a46cdc4459c7394faa7f3e21e5))
- **ide:** register Ctrl+Alt+K shortcut in Pi TUI for /ide attach ([9803840](https://github.com/balaenis/pi-x-ide/commit/9803840f73bc965dae3e0e0a53f7fccae173e2d7))

## [1.7.0](https://github.com/balaenis/pi-x-ide/compare/v1.6.0...v1.7.0) (2026-06-12)

### Features

- **zed:** add configurable poll interval env var and clean up env schema ([04d870e](https://github.com/balaenis/pi-x-ide/commit/04d870e88d756a2faea998e741f8893bc95c3a31))

## [1.6.0](https://github.com/balaenis/pi-x-ide/compare/v1.5.1...v1.6.0) (2026-06-12)

### Features

- **mise:** add compile and compile:all tasks ([517e9cd](https://github.com/balaenis/pi-x-ide/commit/517e9cdfe533294f69d71021680b471662104a32))
- **pi:** limit reconnect attempts and add handshake timeout ([4dc855e](https://github.com/balaenis/pi-x-ide/commit/4dc855e715f1b8bf141a0f055962af53ac581696))

## [1.5.1](https://github.com/balaenis/pi-x-ide/compare/v1.5.0...v1.5.1) (2026-06-11)

### Bug Fixes

- **nvim:** capture sidecar download stderr and handle job start failure ([eae98bf](https://github.com/balaenis/pi-x-ide/commit/eae98bfd7cd313f2e57b4c5665255df6ef30d25f))

## [1.5.0](https://github.com/balaenis/pi-x-ide/compare/v1.4.3...v1.5.0) (2026-06-11)

### Features

- **nvim:** auto-download sidecar binary from GitHub Releases ([85f8e0a](https://github.com/balaenis/pi-x-ide/commit/85f8e0a395cb12f436bf972628d0306e78ee0bf5))
- **nvim:** compile sidecar to standalone binary via bun ([c7b0763](https://github.com/balaenis/pi-x-ide/commit/c7b07632a5d5a683c48f7517334bc4033cb8d556))

## [1.4.3](https://github.com/balaenis/pi-x-ide/compare/v1.4.2...v1.4.3) (2026-06-11)

### Bug Fixes

- always create a fresh Pi terminal instead of reusing existing ([6ad4438](https://github.com/balaenis/pi-x-ide/commit/6ad4438acdd41ea6464c62a0f0ac2858b0c2f2d7))

## [1.4.2](https://github.com/balaenis/pi-x-ide/compare/v1.4.1...v1.4.2) (2026-06-11)

### Bug Fixes

- **pi:** normalize Windows drive letter to uppercase for path matching ([cb4e8ad](https://github.com/balaenis/pi-x-ide/commit/cb4e8adef41d2d80cf2577c3e33879c5aaceb52b))
- **pi:** skip extensionless search on Windows to avoid matching shell scripts ([bb47f76](https://github.com/balaenis/pi-x-ide/commit/bb47f761c7388f316c10d2a6eae53b839e486322))
- **pi:** update install notification on connection success or failure ([46a8901](https://github.com/balaenis/pi-x-ide/commit/46a8901fb271c4c4c6931c02f4da33794224f638))
- update notification messages to reference `/ide` instead of `/ide auto` ([cc27727](https://github.com/balaenis/pi-x-ide/commit/cc277274d1e0fda23e8fbf3e597de9924d2863f5))

## [1.4.1](https://github.com/balaenis/pi-x-ide/compare/v1.4.0...v1.4.1) (2026-06-11)

### Bug Fixes

- **docs:** replace lazy.nvim `rtp` with `init` block in install instructions ([1f186ff](https://github.com/balaenis/pi-x-ide/commit/1f186fffa6e050e495fcece71a8ddc185a4f217d))
- **nvim:** safely stop timer with pcall to prevent errors ([22c422e](https://github.com/balaenis/pi-x-ide/commit/22c422e53057eb2ed7c1b2b343851d751a936632))

## [1.4.0](https://github.com/balaenis/pi-x-ide/compare/v1.3.0...v1.4.0) (2026-06-11)

### Features

- **config:** support pi config env overrides ([1aa20c1](https://github.com/balaenis/pi-x-ide/commit/1aa20c1027ec2172c5ca86cdfb4c1fb362d616b1))

## [1.3.0](https://github.com/balaenis/pi-x-ide/compare/v1.2.0...v1.3.0) (2026-06-10)

### Features

- **vscode:** cache selection snapshot when terminal tab is active ([785f834](https://github.com/balaenis/pi-x-ide/commit/785f834a5092ec77944e7659ca0efa2c6a94f74b))
- **zed:** add Zed editor integration with SQLite polling ([90da726](https://github.com/balaenis/pi-x-ide/commit/90da726a4d997446f3d05d0b3fb9a439572bec9f))
- **zed:** support WSL+Windows path normalization for cross-OS Zed DB access ([963e975](https://github.com/balaenis/pi-x-ide/commit/963e975eb3e4824b8e46015ae324bfcc8c33f6c0))

### Performance Improvements

- **zed:** skip DB snapshot when WAL unchanged, checkpoint into snapshot ([76a6dab](https://github.com/balaenis/pi-x-ide/commit/76a6dab7e6af78a534d9f7401901b1df813dd039))

## [1.2.0](https://github.com/balaenis/pi-x-ide/compare/v1.1.0...v1.2.0) (2026-06-10)

### Features

- **vscode:** add editor toolbar button to open Pi terminal ([6289dbd](https://github.com/balaenis/pi-x-ide/commit/6289dbdab4ba8414231cc38c883724f7a56efcb5))

### Bug Fixes

- **pi:** restrict auto-connect to direct workspace matches ([6899dda](https://github.com/balaenis/pi-x-ide/commit/6899dda792571e2a51402f235d45c7ff3667eeb2))

## [1.1.0](https://github.com/balaenis/pi-x-ide/compare/v1.0.5...v1.1.0) (2026-06-10)

### Features

- **pi:** auto-install IDE extension and add /ide install command ([cbaeb11](https://github.com/balaenis/pi-x-ide/commit/cbaeb11dcd897790f68941b84b297505b370dac6)), closes [#6](https://github.com/balaenis/pi-x-ide/issues/6)

## [1.0.5](https://github.com/balaenis/pi-x-ide/compare/v1.0.4...v1.0.5) (2026-06-10)

### Bug Fixes

- build vsix error display name is taken ([477a044](https://github.com/balaenis/pi-x-ide/commit/477a0447b7c4fbfa0f582c47c649ea0e5c5983bd))

## [1.0.4](https://github.com/balaenis/pi-x-ide/compare/v1.0.3...v1.0.4) (2026-06-10)

### Bug Fixes

- build vsix error ([fab6668](https://github.com/balaenis/pi-x-ide/commit/fab66685ce416fa170a939d74564ca75d480ae50))

## [1.0.3](https://github.com/balaenis/pi-x-ide/compare/v1.0.2...v1.0.3) (2026-06-10)

### Bug Fixes

- force release ([6525d08](https://github.com/balaenis/pi-x-ide/commit/6525d083f661d40a7a9506e8cc93db3fd34a6893))

## [1.0.2](https://github.com/balaenis/pi-x-ide/compare/v1.0.1...v1.0.2) (2026-06-10)

### Bug Fixes

- release workflows ([30f6b70](https://github.com/balaenis/pi-x-ide/commit/30f6b70492746f376b5b0520aefc44be687603d1))

## [1.0.1](https://github.com/balaenis/pi-x-ide/compare/v1.0.0...v1.0.1) (2026-06-10)

### Bug Fixes

- test release pipeline ([2d887b8](https://github.com/balaenis/pi-x-ide/commit/2d887b8a27da44c116e4e6a42c69727c469c873d))

## 1.0.0 (2026-06-09)

### Features

- **ci:** add CI/CD workflows and release automation ([a989bfc](https://github.com/balaenis/pi-x-ide/commit/a989bfc2ed39644d9543e4f8a28ece48a0596612))
- **pi:** add argument completions for ide command ([bc95e88](https://github.com/balaenis/pi-x-ide/commit/bc95e887172ebea5b86263d330c16bad00de3047))
- **protocol:** broadcast selection_cleared when no active editor ([3fd4c32](https://github.com/balaenis/pi-x-ide/commit/3fd4c328e906b29c83fb61d8dfe6d84ba753b180))
- **vscode:** add extension icon and branding assets ([efb71b5](https://github.com/balaenis/pi-x-ide/commit/efb71b5852f6ea81097079c8b42f052a2bd67053))
- **vscode:** send editor selection snapshot on client init ([a268483](https://github.com/balaenis/pi-x-ide/commit/a2684832ba1f3f36ad73cf45a70ae8b76cc61270))

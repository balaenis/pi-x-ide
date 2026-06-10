# Changelog

## [1.3.0](https://github.com/balaenis/pi-x-ide/compare/v1.2.0...v1.3.0) (2026-06-10)


### Features

* **vscode:** cache selection snapshot when terminal tab is active ([785f834](https://github.com/balaenis/pi-x-ide/commit/785f834a5092ec77944e7659ca0efa2c6a94f74b))
* **zed:** add Zed editor integration with SQLite polling ([90da726](https://github.com/balaenis/pi-x-ide/commit/90da726a4d997446f3d05d0b3fb9a439572bec9f))
* **zed:** support WSL+Windows path normalization for cross-OS Zed DB access ([963e975](https://github.com/balaenis/pi-x-ide/commit/963e975eb3e4824b8e46015ae324bfcc8c33f6c0))


### Performance Improvements

* **zed:** skip DB snapshot when WAL unchanged, checkpoint into snapshot ([76a6dab](https://github.com/balaenis/pi-x-ide/commit/76a6dab7e6af78a534d9f7401901b1df813dd039))

## [1.2.0](https://github.com/balaenis/pi-x-ide/compare/v1.1.0...v1.2.0) (2026-06-10)


### Features

* **vscode:** add editor toolbar button to open Pi terminal ([6289dbd](https://github.com/balaenis/pi-x-ide/commit/6289dbdab4ba8414231cc38c883724f7a56efcb5))


### Bug Fixes

* **pi:** restrict auto-connect to direct workspace matches ([6899dda](https://github.com/balaenis/pi-x-ide/commit/6899dda792571e2a51402f235d45c7ff3667eeb2))

## [1.1.0](https://github.com/balaenis/pi-x-ide/compare/v1.0.5...v1.1.0) (2026-06-10)


### Features

* **pi:** auto-install IDE extension and add /ide install command ([cbaeb11](https://github.com/balaenis/pi-x-ide/commit/cbaeb11dcd897790f68941b84b297505b370dac6)), closes [#6](https://github.com/balaenis/pi-x-ide/issues/6)

## [1.0.5](https://github.com/balaenis/pi-x-ide/compare/v1.0.4...v1.0.5) (2026-06-10)


### Bug Fixes

* build vsix error display name is taken ([477a044](https://github.com/balaenis/pi-x-ide/commit/477a0447b7c4fbfa0f582c47c649ea0e5c5983bd))

## [1.0.4](https://github.com/balaenis/pi-x-ide/compare/v1.0.3...v1.0.4) (2026-06-10)


### Bug Fixes

* build vsix error ([fab6668](https://github.com/balaenis/pi-x-ide/commit/fab66685ce416fa170a939d74564ca75d480ae50))

## [1.0.3](https://github.com/balaenis/pi-x-ide/compare/v1.0.2...v1.0.3) (2026-06-10)


### Bug Fixes

* force release ([6525d08](https://github.com/balaenis/pi-x-ide/commit/6525d083f661d40a7a9506e8cc93db3fd34a6893))

## [1.0.2](https://github.com/balaenis/pi-x-ide/compare/v1.0.1...v1.0.2) (2026-06-10)


### Bug Fixes

* release workflows ([30f6b70](https://github.com/balaenis/pi-x-ide/commit/30f6b70492746f376b5b0520aefc44be687603d1))

## [1.0.1](https://github.com/balaenis/pi-x-ide/compare/v1.0.0...v1.0.1) (2026-06-10)


### Bug Fixes

* test release pipeline ([2d887b8](https://github.com/balaenis/pi-x-ide/commit/2d887b8a27da44c116e4e6a42c69727c469c873d))

## 1.0.0 (2026-06-09)


### Features

* **ci:** add CI/CD workflows and release automation ([a989bfc](https://github.com/balaenis/pi-x-ide/commit/a989bfc2ed39644d9543e4f8a28ece48a0596612))
* **pi:** add argument completions for ide command ([bc95e88](https://github.com/balaenis/pi-x-ide/commit/bc95e887172ebea5b86263d330c16bad00de3047))
* **protocol:** broadcast selection_cleared when no active editor ([3fd4c32](https://github.com/balaenis/pi-x-ide/commit/3fd4c328e906b29c83fb61d8dfe6d84ba753b180))
* **vscode:** add extension icon and branding assets ([efb71b5](https://github.com/balaenis/pi-x-ide/commit/efb71b5852f6ea81097079c8b42f052a2bd67053))
* **vscode:** send editor selection snapshot on client init ([a268483](https://github.com/balaenis/pi-x-ide/commit/a2684832ba1f3f36ad73cf45a70ae8b76cc61270))

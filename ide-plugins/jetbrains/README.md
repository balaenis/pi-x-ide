# Pi x IDE JetBrains Plugin

JetBrains plugin for Pi x IDE. It exposes the active file, selected text ranges, and manual attach commands from JetBrains IDEs to Pi through the same local lock-file + authenticated WebSocket protocol used by the other IDE integrations.

## Prerequisites

- JDK 21 (the Gradle build uses a Java 21 toolchain and can download it automatically through Foojay)
- Gradle wrapper (`./gradlew`, included in this directory)
- IntelliJ IDEA 2026.1.3 target downloaded by the IntelliJ Platform Gradle Plugin
- `pi` available on `PATH` if you use **Pi x IDE: Open Pi Terminal**

The build downloads the configured IntelliJ IDEA target automatically. To reuse an existing local IDE, pass `-PlocalIdePath=/path/to/idea` or set `ORG_GRADLE_PROJECT_localIdePath=/path/to/idea`.

## Run in a Sandbox IDE

From the repository root:

```bash
cd ide-plugins/jetbrains
./gradlew runIde
```

Open a local project in the sandbox IDE. The plugin starts a local WebSocket server and writes a lock file under:

```text
~/.pi/pi-x-ide/lock/jetbrains-<pid>-<port>.lock
```

## Package for Manual Installation

```bash
cd ide-plugins/jetbrains
./gradlew buildPlugin
```

The plugin ZIP is produced under:

```text
ide-plugins/jetbrains/build/distributions/
```

Install it manually from JetBrains IDEs via **Settings | Plugins | ⚙ | Install Plugin from Disk...**.

## Manual Smoke Test

1. Run the sandbox IDE:
   ```bash
   cd ide-plugins/jetbrains && ./gradlew runIde
   ```
2. Open this repository as the sandbox project.
3. Start Pi from the same repository directory:
   ```bash
   pi
   ```
4. Open a local file in the sandbox IDE. Pi should connect automatically through `/ide auto` behavior and show JetBrains as the IDE source.
5. Select text. Pi should update its widget with the file and line span.
6. Press `Ctrl+Alt+K` or run **Tools | Pi x IDE: Attach Selection**. Pi should receive an `@relative/path#Lx-Ly` mention.
7. Run **Tools | Pi x IDE: Open Pi Terminal**. The embedded terminal should start in the project directory and execute `pi`.

## MVP Scope

Supported in this MVP:

- Live active-file tracking
- Live non-empty selection tracking
- Active-file snapshots with `ranges: []` when no text is selected
- Manual attach from JetBrains with `Ctrl+Alt+K`
- Pi-side `/ide auto`, `/ide`, `/ide attach`, and context injection
- Opening Pi in an embedded JetBrains terminal

Not included in this MVP:

- Diagnostic Quick Fix / inspection actions
- Pi-side automatic JetBrains plugin installation or updates
- Marketplace publishing/signing automation

// ABOUTME: Parses Windows WSL UNC project paths and builds Pi terminal launch commands.
// ABOUTME: Keeps JetBrains terminals in the right Windows or WSL shell context with login PATH setup.
package com.balaenis.pixide.util

import java.nio.file.Path

data class PiXIdeWslPath(
    val distro: String,
    val linuxPath: String,
)

private val RUN_PI_IN_LOGIN_SHELL = """
shell="${'$'}{SHELL:-/bin/sh}"
case "${'$'}(basename "${'$'}shell")" in
  fish) exec "${'$'}shell" --login --interactive --command pi ;;
  bash|zsh|ksh) exec "${'$'}shell" -lic pi ;;
  *) exec "${'$'}shell" -lc pi ;;
esac
"""

fun parseWslUncPath(path: String?): PiXIdeWslPath? {
    if (path.isNullOrBlank()) return null
    val normalized = path.replace('\\', '/')
    val prefix = when {
        normalized.startsWith("//wsl$/", ignoreCase = true) -> "//wsl$/"
        normalized.startsWith("//wsl.localhost/", ignoreCase = true) -> "//wsl.localhost/"
        else -> return null
    }
    val rest = normalized.substring(prefix.length)
    val parts = rest.split('/', limit = 2)
    val distro = parts.getOrNull(0)?.takeIf { it.isNotBlank() } ?: return null
    val linuxRest = parts.getOrNull(1)?.trimStart('/') ?: ""
    return PiXIdeWslPath(distro = distro, linuxPath = "/$linuxRest")
}

fun terminalCommandForProject(
    basePath: String?,
    osName: String = System.getProperty("os.name").orEmpty(),
    shellPath: String? = System.getenv("SHELL"),
): List<String> {
    val wslPath = parseWslUncPath(basePath)
    return when {
        osName.startsWith("Windows", ignoreCase = true) && wslPath != null -> listOf(
            "wsl.exe",
            "-d",
            wslPath.distro,
            "--cd",
            wslPath.linuxPath,
            "--exec",
            "/bin/sh",
            "-lc",
            RUN_PI_IN_LOGIN_SHELL.trim(),
        )
        osName.startsWith("Windows", ignoreCase = true) -> listOf("pi")
        else -> loginShellCommand(shellPath)
    }
}

fun terminalWorkingDirectoryForProject(
    basePath: String?,
    userHome: String = System.getProperty("user.home"),
    osName: String = System.getProperty("os.name").orEmpty(),
): String = if (osName.startsWith("Windows", ignoreCase = true) && parseWslUncPath(basePath) != null) {
    userHome
} else {
    basePath ?: userHome
}

private fun loginShellCommand(shellPath: String?): List<String> {
    val shell = shellPath?.takeIf { it.isNotBlank() } ?: "/bin/sh"
    return when (Path.of(shell).fileName.toString()) {
        "fish" -> listOf(shell, "--login", "--interactive", "--command", "pi")
        "bash", "zsh", "ksh" -> listOf(shell, "-lic", "pi")
        else -> listOf(shell, "-lc", "pi")
    }
}

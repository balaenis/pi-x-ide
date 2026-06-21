// ABOUTME: Parses Windows WSL UNC project paths and builds Pi terminal launch commands.
// ABOUTME: Keeps JetBrains Windows projects on \\wsl$ launching Pi inside the target distro.
package com.balaenis.pixide.util

data class PiXIdeWslPath(
    val distro: String,
    val linuxPath: String,
)

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
): List<String> {
    val wslPath = parseWslUncPath(basePath)
    return if (osName.startsWith("Windows", ignoreCase = true) && wslPath != null) {
        listOf("wsl.exe", "-d", wslPath.distro, "--cd", wslPath.linuxPath, "pi")
    } else {
        listOf("pi")
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

// ABOUTME: Tests WSL UNC parsing and Pi terminal command construction for JetBrains.
// ABOUTME: Ensures Windows-side IDEs launch Pi inside the intended WSL distro and path.
package com.balaenis.pixide.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PiXIdeWslPathTest {
    @Test
    fun parsesBackslashWslUncPaths() {
        assertEquals(
            PiXIdeWslPath(distro = "Ubuntu", linuxPath = "/home/julian/repo"),
            parseWslUncPath("\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo"),
        )
        assertEquals(
            PiXIdeWslPath(distro = "archlinux", linuxPath = "/home/julian/repo"),
            parseWslUncPath("\\\\wsl$\\archlinux\\home\\julian\\repo"),
        )
    }

    @Test
    fun parsesForwardSlashWslUncPaths() {
        assertEquals(
            PiXIdeWslPath(distro = "Ubuntu", linuxPath = "/home/julian/repo"),
            parseWslUncPath("//wsl.localhost/Ubuntu/home/julian/repo"),
        )
        assertEquals(
            PiXIdeWslPath(distro = "Ubuntu", linuxPath = "/home/julian/repo"),
            parseWslUncPath("//wsl$/Ubuntu/home/julian/repo"),
        )
    }

    @Test
    fun ignoresNonWslUncPaths() {
        assertNull(parseWslUncPath("C:\\Users\\julian\\repo"))
        assertNull(parseWslUncPath("/home/julian/repo"))
        assertNull(parseWslUncPath("//server/share/repo"))
    }

    @Test
    fun buildsWindowsWslTerminalCommandThroughLoginShell() {
        val command = terminalCommandForProject("\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo", osName = "Windows 11")
        assertEquals(listOf("wsl.exe", "-d", "Ubuntu", "--cd", "/home/julian/repo", "--exec", "/bin/sh", "-lc"), command.take(8))
        assertTrue(command.last().contains("exec \"${'$'}shell\" -lic pi"))
        assertEquals(
            "C:\\Users\\julian",
            terminalWorkingDirectoryForProject(
                "\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo",
                userHome = "C:\\Users\\julian",
                osName = "Windows 11",
            ),
        )
    }

    @Test
    fun keepsWindowsNativeTerminalCommandOutsideWslProjects() {
        assertEquals(listOf("pi"), terminalCommandForProject("C:\\Users\\julian\\repo", osName = "Windows 11"))
    }

    @Test
    fun usesLoginShellForNativeUnixProjects() {
        assertEquals(listOf("/usr/bin/zsh", "-lic", "pi"), terminalCommandForProject("/home/julian/repo", osName = "Linux", shellPath = "/usr/bin/zsh"))
        assertEquals(listOf("/usr/bin/fish", "--login", "--interactive", "--command", "pi"), terminalCommandForProject("/home/julian/repo", osName = "Linux", shellPath = "/usr/bin/fish"))
        assertEquals(listOf("/bin/sh", "-lc", "pi"), terminalCommandForProject("/home/julian/repo", osName = "Linux", shellPath = "/bin/sh"))
        assertEquals("/home/julian/repo", terminalWorkingDirectoryForProject("/home/julian/repo", userHome = "/home/julian"))
        assertEquals("/home/julian", terminalWorkingDirectoryForProject(null, userHome = "/home/julian"))
    }
}

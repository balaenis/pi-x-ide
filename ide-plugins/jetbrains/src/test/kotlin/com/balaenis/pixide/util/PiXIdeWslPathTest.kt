// ABOUTME: Tests WSL UNC parsing and Pi terminal command construction for JetBrains.
// ABOUTME: Ensures Windows-side IDEs launch Pi inside the intended WSL distro and path.
package com.balaenis.pixide.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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
    fun buildsWindowsWslTerminalCommand() {
        assertEquals(
            listOf("wsl.exe", "-d", "Ubuntu", "--cd", "/home/julian/repo", "pi"),
            terminalCommandForProject("\\\\wsl.localhost\\Ubuntu\\home\\julian\\repo", osName = "Windows 11"),
        )
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
    fun keepsNativeTerminalCommandOutsideWindowsWslProjects() {
        assertEquals(listOf("pi"), terminalCommandForProject("/home/julian/repo", osName = "Linux"))
        assertEquals(listOf("pi"), terminalCommandForProject("C:\\Users\\julian\\repo", osName = "Windows 11"))
        assertEquals("/home/julian/repo", terminalWorkingDirectoryForProject("/home/julian/repo", userHome = "/home/julian"))
        assertEquals("/home/julian", terminalWorkingDirectoryForProject(null, userHome = "/home/julian"))
    }
}

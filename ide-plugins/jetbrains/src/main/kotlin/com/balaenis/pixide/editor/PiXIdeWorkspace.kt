// ABOUTME: Resolves JetBrains project workspace folders and display paths for pi-x-ide mentions.
// ABOUTME: Chooses the closest workspace root for a file using normalized local filesystem paths.
package com.balaenis.pixide.editor

import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import java.nio.file.InvalidPathException
import java.nio.file.Path

object PiXIdeWorkspace {
    fun workspaceFolders(project: Project): List<String> {
        val roots = runCatching {
            ProjectRootManager.getInstance(project).contentRoots.mapNotNull { it.path.takeIf(String::isNotBlank) }
        }.getOrDefault(emptyList())
        val base = project.basePath?.takeIf(String::isNotBlank)
        return (roots + listOfNotNull(base)).distinct()
    }

    fun bestWorkspaceFolder(project: Project, filePath: String): String? {
        val folders = workspaceFolders(project)
        if (folders.isEmpty()) return null
        val file = normalizedPath(filePath) ?: return folders.first()
        return folders
            .mapNotNull { folder -> normalizedPath(folder)?.let { folder to it } }
            .filter { (_, folderPath) -> file.startsWith(folderPath) }
            .maxByOrNull { (_, folderPath) -> folderPath.nameCount }
            ?.first
            ?: folders.first()
    }

    fun relativePath(filePath: String, workspaceFolder: String?): String {
        if (workspaceFolder.isNullOrBlank()) return filePath.replace('\\', '/')
        val file = normalizedPath(filePath) ?: return filePath.replace('\\', '/')
        val root = normalizedPath(workspaceFolder) ?: return filePath.replace('\\', '/')
        return runCatching { root.relativize(file).toString().replace('\\', '/') }
            .getOrElse { filePath.replace('\\', '/') }
    }

    private fun normalizedPath(value: String): Path? = try {
        Path.of(value).toAbsolutePath().normalize()
    } catch (_: InvalidPathException) {
        null
    }
}

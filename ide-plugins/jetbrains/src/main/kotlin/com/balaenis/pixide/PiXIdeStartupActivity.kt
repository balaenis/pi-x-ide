// ABOUTME: Starts the Pi x IDE JetBrains project service after a project opens.
// ABOUTME: Uses the coroutine-based ProjectActivity startup API from the IntelliJ Platform.
package com.balaenis.pixide

import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

class PiXIdeStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        project.service<PiXIdeProjectService>().start()
    }
}

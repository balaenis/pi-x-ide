// ABOUTME: Gradle settings for the Pi x IDE JetBrains plugin module.
// ABOUTME: Configures the IntelliJ Platform settings plugin, JDK toolchain resolver, and repositories.
import org.jetbrains.intellij.platform.gradle.extensions.intellijPlatform

rootProject.name = "pi-x-ide-jetbrains"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies")
    }

    plugins {
        id("org.jetbrains.kotlin.jvm") version "2.4.0"
    }
}

plugins {
    // Resolves JDK toolchains automatically so the build does not depend on the host JDK version.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
    id("org.jetbrains.intellij.platform.settings") version "2.16.0"
}

@Suppress("UnstableApiUsage")
dependencyResolutionManagement {
    repositories {
        mavenCentral()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies")

        // IntelliJ Platform Gradle Plugin repositories (release IDEs, marketplace, etc.).
        intellijPlatform {
            defaultRepositories()
        }
    }
}

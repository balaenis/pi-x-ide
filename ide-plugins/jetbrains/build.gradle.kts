// ABOUTME: IntelliJ Platform plugin build configuration for the Pi x IDE JetBrains plugin.
// ABOUTME: Sets up Kotlin/JVM, the IntelliJ Platform dependency, plugin packaging, verification, and tests.
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.intellij.platform")
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()

    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    // Bundled JSON + WebSocket dependencies the plugin ships at runtime.
    implementation("org.java-websocket:Java-WebSocket:1.6.0")
    implementation("com.google.code.gson:gson:2.14.0")

    testImplementation(kotlin("test"))
    testImplementation("junit:junit:4.13.2")

    // IntelliJ Platform Gradle Plugin dependencies extension.
    // IntelliJ IDEA Community and Ultimate merged into a single unified distribution from 2025.3 onward,
    // so a 2026.1 target resolves through the unified `intellijIdea(version)` helper. The legacy
    // `intellijIdeaCommunity(version)` helper only resolves product lines earlier than 2025.3.
    intellijPlatform {
        val localIdePath = providers.gradleProperty("localIdePath")
        if (localIdePath.isPresent) {
            local(localIdePath.get())
        } else {
            intellijIdea(providers.gradleProperty("platformVersion").get())
        }
        bundledPlugin("org.jetbrains.plugins.terminal")
        testFramework(TestFrameworkType.Platform)
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "balaenis.pi-x-ide"
        name = "Pi x IDE"
        version = providers.gradleProperty("pluginVersion")

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // No untilBuild pin: keep the plugin compatible with newer platform builds.
        }
    }

    pluginVerification {
        ides {
            current()
        }
    }
}

tasks {
    test {
        useJUnitPlatform()
    }
}

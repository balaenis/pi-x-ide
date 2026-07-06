// ABOUTME: IntelliJ Platform plugin build configuration for the Pi x IDE JetBrains plugin.
// ABOUTME: Sets up Kotlin/JVM, the IntelliJ Platform dependency, plugin packaging, verification, and tests.
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("org.jetbrains.kotlin.jvm")
    id("org.jetbrains.intellij.platform")
}

val pluginVersionProvider = providers.gradleProperty("pluginVersion")

group = providers.gradleProperty("pluginGroup").get()
version = pluginVersionProvider.get()

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

        // Marketplace ZIP Signer CLI used by the `signPlugin` task. In the IntelliJ Platform
        // Gradle Plugin 2.x this must be declared explicitly; it is no longer bundled automatically.
        zipSigner()
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "balaenis.pi-x-ide"
        name = "Pi x IDE"
        version = pluginVersionProvider

        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // No untilBuild pin: keep the plugin compatible with newer platform builds.
        }
    }

    // Plugin signing credentials are read from environment variables so the private key never
    // lives in the repository. The `signPlugin` task is skipped automatically when they are absent,
    // so local builds and the GitHub-release-only path keep working without secrets configured.
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }

    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
        // Route pre-release versions to a matching custom channel and stable versions to `default`.
        // Example: 1.14.0-alpha.1 -> "alpha" channel, 1.13.1 -> "default" channel.
        channels = pluginVersionProvider
            .map { listOf(it.substringAfter('-', "").substringBefore('.').ifEmpty { "default" }) }
    }

    pluginVerification {
        ides {
            current()
        }
    }
}

// Workaround: verifyPluginSignature in intellij-platform-gradle-plugin 2.16.0
// has a bug where `certificateChain` content is leaked as an extra CLI positional
// argument, causing the ZIP Signer to print Usage and fail. Using
// `certificateChainFile` (file path) avoids this code path.
// CERTIFICATE_CHAIN_FILE env var must point to the absolute path of chain.crt.
// Note: this script-level task config can't be serialized by the configuration
// cache, so run with --no-configuration-cache (the mise task does this).
val certChainFileProvider = providers.environmentVariable("CERTIFICATE_CHAIN_FILE")
    .map { layout.projectDirectory.file(it) }

tasks {
    processResources {
        val pluginVersion = pluginVersionProvider.get()
        inputs.property("pluginVersion", pluginVersion)
        filesMatching("pi-x-ide.properties") {
            expand("pluginVersion" to pluginVersion)
        }
    }

    test {
        useJUnitPlatform()
    }

    verifyPluginSignature {
        certificateChain.convention(null as String?)
        certificateChainFile.convention(certChainFileProvider)
    }
}

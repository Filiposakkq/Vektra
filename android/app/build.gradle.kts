import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// One version for the extension and the app: package.json at the repository root.
val vektraVersion = (JsonSlurper().parse(rootDir.resolve("../package.json")) as Map<*, *>)["version"] as String
val (major, minor, patch) = vektraVersion.split(".").map { it.toInt() }

android {
    namespace = "com.vektra.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.vektra.app"
        minSdk = 26
        targetSdk = 35
        versionName = vektraVersion
        versionCode = major * 10_000 + minor * 100 + patch
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    testImplementation("junit:junit:4.13.2")
}

// The overlay page (android/web) is built from the shared TypeScript core.
val overlayPage = file("src/main/assets/web/index.html")
tasks.named("preBuild") {
    doFirst {
        check(overlayPage.exists()) { "The overlay page is missing: run `npm run build:android-web` in the repository root first." }
    }
}

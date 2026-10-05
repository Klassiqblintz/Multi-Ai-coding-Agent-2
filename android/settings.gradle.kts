pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    // AGP 9.1.0 requires a newer Gradle than this project's wrapper pins (9.3.1) and
    // fails with NoSuchMethodError on StartParameterInternal.getIsolatedProjects().
    // 8.11.1 is the AGP floor Flutter 3.47.5 enforces (errorAGPVersion) and avoids AGP 9's
    // built-in-Kotlin mode, which conflicts with the separately applied
    // org.jetbrains.kotlin.android plugin inside Flutter plugin subprojects.
    id("com.android.application") version "8.11.1" apply false
    // Flutter requires KGP >= 2.2.20. 2.2.20 is the right choice here: it ships a
    // `gradle813` capability variant, which Gradle 8.14.3 selects natively. KGP 2.4.0 has
    // no matching accessor for Gradle 8, and its Gradle-7.6-targeting accessor
    // (ProjectIsolationStartParameterAccessorG76) calls a StartParameterInternal method
    // whose signature differs, so applying it dies with NoSuchMethodError.
    id("org.jetbrains.kotlin.android") version "2.2.20" apply false
}

include(":app")

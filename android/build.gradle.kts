allprojects {
    repositories {
        // Prefer the pre-provisioned offline Maven repo so the build never depends
        // on the flaky network. google()/mavenCentral() remain as fallbacks.
        maven { url = uri("/root/maven/localMvnRepository") }
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}

// Flutter plugin subprojects (e.g. android_file_picker) read `extensions.getByName("flutter")`
// during their own configuration, but that extension is registered by FlutterPlugin.apply() on the
// app project. Configuring :app first guarantees the extension exists before any plugin
// subproject is evaluated. This was safe to drop only under Gradle 9, where the KGP accessor
// used here hit a removed StartParameterInternal API; on Gradle 8.14.3 it is required.
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

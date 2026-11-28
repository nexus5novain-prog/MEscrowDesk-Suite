pluginManagement {
    repositories {
        gradlePluginPortal()
        google()
        mavenCentral()
    }
}

rootProject.name = "PlainApp"
include(":app")
include(":shared")
include(":plain-common")
include(":ui-check")

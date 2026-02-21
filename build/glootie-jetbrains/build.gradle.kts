plugins {
  id("java")
  id("org.jetbrains.intellij") version "1.17.0"
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
}

group = "com.glootie"
version = "2.0.5"

repositories {
  mavenCentral()
  intellijPlatform { defaultRepositories() }
}

dependencies {
  intellijPlatform {
    intellijIdeaCommunity("2024.1.0")
    bundledPlugins("com.intellij.java")
    bundledPlugins("org.jetbrains.kotlin")
    pluginVerifier()
    testFramework()
  }
  implementation("org.jetbrains.kotlin:kotlin-stdlib")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
  implementation("com.squareup.okhttp3:okhttp:4.11.0")
}

intellij {
  pluginName = "Glootie"
  version = "2024.1.0"
  type = "IC"
  updateSinceUntilBuild = false
  plugins = ["java", "kotlin"]
}
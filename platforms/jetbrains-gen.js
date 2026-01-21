module.exports = {
  generatePluginXml(pluginSpec) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<idea-plugin>
  <id>com.glootie.glootie</id>
  <name>Glootie - State Machine</name>
  <version>${pluginSpec.version}</version>
  <vendor email="hello@glootie.dev">Glootie</vendor>
  <description>${pluginSpec.description || 'AI state machine for JetBrains IDEs'}</description>
  <idea-version since-build="222.0"/>
  <depends>com.intellij.modules.platform</depends>
  <depends>com.intellij.modules.vcs</depends>
  <extensions defaultExtensionNs="com.intellij">
    <toolWindow id="Glootie" anchor="right" icon="AllIcons.Webreferences.Server"
                factoryClass="com.glootie.GlootieToolWindowFactory" enableByDefault="true"/>
    <projectService serviceImplementation="com.glootie.GlootieService"/>
    <applicationService serviceImplementation="com.glootie.GlootieApplicationService"/>
    <notificationGroup id="Glootie Notifications" displayType="BALLOON"/>
    <completion.contributor language="any" implementationClass="com.glootie.GlootieCompletionContributor"/>
    <projectConfigurable groupId="tools" id="com.glootie.settings" displayName="Glootie"
                         instanceClass="com.glootie.GlootieConfigurable" nonDefaultProject="false"/>
  </extensions>
  <actions>
    <group id="Glootie.Menu" text="Glootie">
      <action id="Glootie.Activate" class="com.glootie.actions.ActivateAction" text="Activate"/>
      <action id="Glootie.Deactivate" class="com.glootie.actions.DeactivateAction" text="Deactivate"/>
      <action id="Glootie.ShowState" class="com.glootie.actions.ShowStateAction" text="Show State" keymap="ctrl alt shift G"/>
      <add-to-group group-id="ToolsMenu" anchor="last"/>
    </group>
  </actions>
  <listeners>
    <listener class="com.glootie.listeners.ProjectOpenListener" topic="com.intellij.openapi.project.ProjectManagerListener"/>
  </listeners>
</idea-plugin>`;
  },

  generateBuildGradle(pluginSpec) {
    return `plugins {
  id("java")
  id("org.jetbrains.intellij") version "1.17.0"
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
}

group = "com.glootie"
version = "${pluginSpec.version}"

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
}`;
  },

  generatePluginClass() {
    return `package com.glootie

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
class GlootieService(val project: Project) {
  var isActive = false
  var state = mutableMapOf<String, Any>()

  fun activate() {
    isActive = true
    state["activated"] = System.currentTimeMillis()
  }

  fun deactivate() {
    isActive = false
    state.clear()
  }

  fun getState(): Map<String, Any> = state.toMap()
  fun setState(newState: Map<String, Any>) { state.putAll(newState) }
  fun clearState() { state.clear(); isActive = false }
}

@Service(Service.Level.APP)
class GlootieApplicationService {
  var settings = mutableMapOf(
    "enabled" to true,
    "autoActivate" to true,
    "logLevel" to "info"
  )

  fun updateSettings(newSettings: Map<String, Any>) { settings.putAll(newSettings) }
  fun getSetting(key: String, default: Any? = null): Any? = settings[key] ?: default
}`;
  },

  generateToolWindow() {
    return `package com.glootie

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import javax.swing.JLabel
import javax.swing.JPanel

class GlootieToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val panel = JPanel()
    panel.add(JLabel("Glootie State Machine"))
    val content = ContentFactory.getInstance().createContent(panel, "Glootie State", false)
    toolWindow.contentManager.addContent(content)
  }
  override fun shouldBeAvailable(project: Project) = true
}`;
  },

  generateReadme() {
    return `# Glootie for JetBrains IDEs

AI state machine plugin for all JetBrains IDEs.

## Supported IDEs

- IntelliJ IDEA
- PyCharm
- WebStorm
- GoLand
- CLion
- Rider
- PhpStorm

## Installation

From Plugin Marketplace:
1. Open IDE
2. Settings → Plugins → Marketplace
3. Search "Glootie"
4. Install and restart

## Features

- Unified state machine
- Code analysis
- Real-time sync
- Hot reload
- Multi-language support

## Quick Start

1. Tools → Glootie → Activate
2. Ctrl+Alt+Shift+G (Show State)
3. Right-click → Glootie → Analyze

## Configuration

Settings → Tools → Glootie

## License

MIT
`;
  }
};

const ExtensionAdapter = require('../lib/extension-adapter');
const { jetbrainsPluginXml } = require('./ide-manifests');
const TemplateBuilder = require('../lib/template-builder');

class JetBrainsAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'jetbrains',
      label: 'JetBrains IDEs',
      configFile: 'plugin.xml',
      manifestType: 'jetbrains'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    const structure = {
      'plugin.xml': this.generatePluginXml(pluginSpec),
      'build.gradle.kts': this.generateBuildGradle(pluginSpec),
      'src/main/kotlin/com/gm/GlootiePlugin.kt': this.generatePluginClass(),
      'src/main/kotlin/com/gm/GlootieToolWindow.kt': this.generateToolWindow(),
      'src/main/resources/META-INF/plugin.xml': this.generatePluginXml(pluginSpec),
      'README.md': this.generateReadme(),
      'docs/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'docs/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'docs/websearch.md': readFile(this.getAgentSourcePaths('websearch'))
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    return structure;
  }

  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'docs/skills');
  }

  generateExtensionManifest(pluginSpec) {
    return this.generatePluginXml(pluginSpec);
  }

  generatePluginXml(pluginSpec) {
    return jetbrainsPluginXml(pluginSpec);
  }

  generateBuildGradle(pluginSpec) {
    return `plugins {
  id("java")
  id("org.jetbrains.intellij") version "1.17.0"
  id("org.jetbrains.kotlin.jvm") version "1.9.22"
}

group = "com.gm"
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
  }

  generatePluginClass() {
    return `package com.gm

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
  }

  generateToolWindow() {
    return `package com.gm

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
  }

  generateReadme() {
    return `# Glootie for JetBrains IDEs

AI state machine plugin for all JetBrains IDEs with semantic code search.

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

- **Semantic Code Search**: Use natural language to explore your codebase
  - "Find authentication validation" → Discovers auth checks, guards, permission logic
  - "Where is database initialization?" → Finds connections, migrations, schemas
  - "Show error handling patterns" → Locates try/catch, error boundaries, handlers
- Unified state machine
- Code analysis
- Real-time sync
- Hot reload
- Multi-language support

## Semantic Code Search

Your IDE uses **semantic code search** - describe what you're looking for in plain language, not regex.

### How It Works
- Intent-based queries understand meaning across files
- Finds related code patterns regardless of implementation
- Discovers where features are implemented across your project

### When to Use
- Exploring unfamiliar codebases
- Finding similar patterns
- Understanding component integrations
- Locating feature implementations
- Discovering related code sections

## Quick Start

1. Tools → Glootie → Activate
2. Ctrl+Alt+Shift+G (Show State)
3. Right-click → Glootie → Analyze
4. Use semantic code search: type "Find [what you're looking for]" in queries

## Configuration

Settings → Tools → Glootie

## License

MIT
`;
  }
}

module.exports = JetBrainsAdapter;

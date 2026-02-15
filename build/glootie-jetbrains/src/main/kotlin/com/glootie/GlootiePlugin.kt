package com.glootie

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
}
package com.gm

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import javax.swing.JLabel
import javax.swing.JPanel

class GmToolWindowFactory : ToolWindowFactory {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val panel = JPanel()
    panel.add(JLabel("GM State Machine"))
    val content = ContentFactory.getInstance().createContent(panel, "GM State", false)
    toolWindow.contentManager.addContent(content)
  }
  override fun shouldBeAvailable(project: Project) = true
}
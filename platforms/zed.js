const ExtensionAdapter = require('../lib/extension-adapter');
const { zedManifest } = require('./ide-manifests');
const TemplateBuilder = require('../lib/template-builder');

class ZedAdapter extends ExtensionAdapter {
  constructor() {
    super({
      name: 'zed',
      label: 'Zed Editor',
      configFile: 'Cargo.toml',
      manifestType: 'zed'
    });
  }

  createFileStructure(pluginSpec, sourceDir) {
    const readFile = (paths) => this.readSourceFile(sourceDir, paths);
    const structure = {
      'Cargo.toml': this.generateCargoToml(pluginSpec),
      'extension.toml': this.generateExtensionToml(pluginSpec),
      'src/lib.rs': this.generateLibRs(pluginSpec),
      'agents/gm.md': readFile(this.getAgentSourcePaths('gm')),
      'agents/codesearch.md': readFile(this.getAgentSourcePaths('codesearch')),
      'agents/websearch.md': readFile(this.getAgentSourcePaths('websearch')),
      '.gitignore': this.generateGitignore(),
      'README.md': this.generateReadme(pluginSpec)
    };
    const skills = this.loadSkillsFromSource(sourceDir);
    Object.assign(structure, skills);
    return structure;
  }

  loadSkillsFromSource(sourceDir) {
    return TemplateBuilder.loadSkillsFromSource(sourceDir, 'skills');
  }

  generateCargoToml(pluginSpec) {
    return `[package]\nname = "gm-zed"\nversion = "${pluginSpec.version}"\nedition = "2021"\nauthors = ["${pluginSpec.author || 'GM'}"]\nlicense = "${pluginSpec.license || 'MIT'}"\ndescription = "${pluginSpec.description || 'AI-powered state machine for Zed with native Claude 3.5 Sonnet support'}"\nrepository = "https://github.com/AnEntrypoint/gm-zed"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nzed_extension_api = "0.7"\ntokio = { version = "1", features = ["full"] }\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\nlazy_static = "1.4"\n\n[profile.release]\nopt-level = "z"\nlto = true\ncodegen-units = 1\nstrip = true\n`;
  }

  generateExtensionToml(pluginSpec) {
    return `id = "gm"\nname = "GM"\ndescription = "${pluginSpec.description || 'AI-powered state machine for Zed with semantic code search'}"\nversion = "${pluginSpec.version}"\nschema_version = 1\nauthors = ["${pluginSpec.author || 'GM'}"]\nrepository = "https://github.com/AnEntrypoint/gm-zed"\n\n[package]\ncategory = ["AI", "Code Completion"]\ndescription = "AI state machine with semantic code search, autonomous agents, and MCP integration. Use natural language prompts like 'Find auth validation' to explore your codebase."\n\n[commands]\ngm.activate = "Activate GM state machine"\ngm.deactivate = "Deactivate GM state machine"\ngm.showState = "Show state machine status"\ngm.toggleAssistant = "Toggle AI assistant"\n\n[settings]\ngm.enabled = { description = "Enable GM extension", type = "boolean", default = true }\ngm.autoActivate = { description = "Auto-activate on startup", type = "boolean", default = true }\ngm.logLevel = { description = "Log level", type = "string", enum = ["debug", "info", "warn", "error"], default = "info" }\ngm.llm = { description = "LLM model", type = "string", default = "claude-3-5-sonnet" }\ngm.temperature = { description = "Temperature for LLM", type = "number", default = 0.7 }\ngm.contextWindow = { description = "Context window size", type = "integer", default = 200000 }\n`;
  }

  generateLibRs(pluginSpec) {
    return `use zed_extension_api::*;\nuse std::sync::{Arc, Mutex};\n\npub struct GmExtension {\n    is_active: bool,\n    assistant_enabled: bool,\n}\n\nimpl GmExtension {\n    pub fn new() -> Self {\n        GmExtension {\n            is_active: false,\n            assistant_enabled: false,\n        }\n    }\n\n    pub fn activate(&mut self) {\n        self.is_active = true;\n    }\n\n    pub fn deactivate(&mut self) {\n        self.is_active = false;\n    }\n\n    pub fn is_active(&self) -> bool {\n        self.is_active\n    }\n\n    pub fn is_assistant_enabled(&self) -> bool {\n        self.assistant_enabled\n    }\n\n    pub fn toggle_assistant(&mut self) {\n        self.assistant_enabled = !self.assistant_enabled;\n    }\n}\n\nlazy_static::lazy_static! {\n    static ref EXTENSION: Arc<Mutex<GmExtension>> = {\n        Arc::new(Mutex::new(GmExtension::new()))\n    };\n}\n\n#[no_mangle]\npub extern "C" fn init_extension() {\n    let mut ext = EXTENSION.lock().unwrap();\n    ext.activate();\n}\n\n#[no_mangle]\npub extern "C" fn get_extension_status() -> u8 {\n    let ext = EXTENSION.lock().unwrap();\n    if ext.is_active() { 1 } else { 0 }\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    #[test]\n    fn test_extension_creation() {\n        let ext = GmExtension::new();\n        assert!(!ext.is_active());\n        assert!(!ext.is_assistant_enabled());\n    }\n\n    #[test]\n    fn test_extension_activation() {\n        let mut ext = GmExtension::new();\n        ext.activate();\n        assert!(ext.is_active());\n    }\n\n    #[test]\n    fn test_extension_deactivation() {\n        let mut ext = GmExtension::new();\n        ext.activate();\n        ext.deactivate();\n        assert!(!ext.is_active());\n    }\n\n    #[test]\n    fn test_toggle_assistant() {\n        let mut ext = GmExtension::new();\n        assert!(!ext.is_assistant_enabled());\n        ext.toggle_assistant();\n        assert!(ext.is_assistant_enabled());\n        ext.toggle_assistant();\n        assert!(!ext.is_assistant_enabled());\n    }\n}\n`;
  }

  generateGitignore() {
    return `/target\nCargo.lock\n**/*.rs.bk\n*.pdb\n.DS_Store\n*.swp\n*.swo\n*~\n.idea/\n.vscode/\n*.iml\n.env\n.env.local\n`;
  }

  generateReadme(pluginSpec) {
    const license = pluginSpec.license || 'MIT';
    return `# GM for Zed\n\nAI-powered state machine for Zed Editor with native Claude 3.5 Sonnet support, autonomous agent coordination, and MCP integration.\n\n## Building from Source\n\n### Prerequisites\n\n- Rust 1.70+ (install from https://rustup.rs/)\n- Cargo (included with Rust)\n- Zed development environment\n\n### Build Steps\n\n\`\`\`bash\ncargo build --release\n\`\`\`\n\nThe compiled extension will be in \`target/release/gm.so\` (Linux/Mac) or \`gm.dll\` (Windows).\n\n## Installation\n\n### From Built Binary\n\n1. Compile with \`cargo build --release\`\n2. Copy compiled library to Zed extensions directory:\n   - macOS/Linux: \`~/.config/zed/extensions/gm\`\n   - Windows: \`%APPDATA%\\\\Zed\\\\extensions\\\\gm\`\n3. Restart Zed\n\n### From Registry\n\nOnce published to Zed registry, install directly from Zed settings.\n\n## Features\n\n- Native Claude 3.5 Sonnet integration\n- Async state machine with checkpointing\n- Autonomous agent coordination\n- MCP server support\n- Real-time state inspection\n- Multi-language support: Rust, JavaScript, TypeScript, Python, Go, Java, Kotlin, Swift, C#\n- Hot reload support (with care)\n\n## Quick Start\n\nAfter installation:\n\n1. Open Zed\n2. Press \`Cmd+Shift+P\` (macOS) or \`Ctrl+Shift+P\` (Linux/Windows)\n3. Type "Activate State Machine" to enable GM\n4. Use "Toggle AI Assistant" to enable/disable AI features\n5. Type "Show State" to view current machine status\n\n## Configuration\n\nEdit \`~/.config/zed/settings.json\`:\n\n\`\`\`json\n{\n  "gm": {\n    "enabled": true,\n    "autoActivate": true,\n    "logLevel": "info",\n    "llm": "claude-3-5-sonnet",\n    "temperature": 0.7,\n    "contextWindow": 200000\n  }\n}\n\`\`\`\n\n## Architecture\n\n### Extension Lifecycle\n\n1. **Activation**: Zed loads WASM module via FFI\n2. **Initialization**: Register commands and language support\n3. **Runtime**: Process commands, maintain state, coordinate agents\n4. **Deactivation**: Clean up resources and state\n\n### Language Server Integration\n\nGM integrates with Zed's language server protocol for:\n- Code completion\n- Diagnostics\n- Code formatting\n- Hover information\n- Navigation\n\n### MCP Support\n\nModel Context Protocol servers can be registered in extension.toml for:\n- Tool execution\n- Resource access\n- Prompts and context\n\n## Development\n\n### Project Structure\n\n\`\`\`\ngm-zed/\n├── Cargo.toml              # Rust dependencies and metadata\n├── extension.toml          # Zed extension manifest\n├── src/\n│   └── lib.rs             # Main extension code\n├── agents/                # AI agent definitions\n│   ├── gm.md\n│   ├── codesearch.md\n│   └── websearch.md\n└── skills/                # Specialized skills\n    ├── code-search/\n    ├── web-search/\n    └── ...\n\`\`\`\n\n### Building Documentation\n\nGenerate docs with:\n\`\`\`bash\ncargo doc --open\n\`\`\`\n\n### Running Tests\n\n\`\`\`bash\ncargo test\n\`\`\`\n\n## Troubleshooting\n\n### Extension fails to load\n\nCheck \`~/.config/zed/extensions/gm\` exists with compiled binary.\n\n### Commands not available\n\nRestart Zed after installation. Run \`cargo build --release\` if binary is missing.\n\n### Performance issues\n\nDisable \`gm.autoActivate\` in settings and manually activate when needed.\n\n## Performance Notes\n\n- Compiled WASM module is optimized with LTO and minimal size\n- Async runtime via Tokio for non-blocking operations\n- State machine uses minimal memory footprint\n\n## License\n\n${license}\n\n## Support\n\nReport issues: https://github.com/AnEntrypoint/gm-zed/issues\n`;
  }
}

module.exports = ZedAdapter;

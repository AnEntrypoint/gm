---
name: hot-reload-systems
description: Systems with zero-downtime code reloading, state preservation, and connection persistence
---

HOT RELOAD IS MANDATORY

State lives outside code in stable scope outside reloadable modules. Connections preserved. Handlers swap atomically. Zero downtime. Zero dropped requests. State coupled to code is forbidden. Connection loss is forbidden. Request drop is forbidden. Restart required is forbidden.

Module boundaries are reload boundaries. Watchers trigger reload. Old drains while new attaches. Separate stable from volatile. Monolithic unreloadable modules are forbidden.
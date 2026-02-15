# Contributing

Please ensure all code follows the conventions established in this project.

## Before Committing

Run the build to verify everything is working:

```bash
npm run build plugforge-starter [output-dir]
```

## Platform Conventions

- Each platform adapter in `platforms/` extends PlatformAdapter or CLIAdapter
- File generation logic goes in `createFileStructure()`
- Use TemplateBuilder methods for shared generation logic
- Skills are auto-discovered from plugforge-starter/skills/

## Testing

Build all 9 platform outputs:

```bash
node cli.js plugforge-starter /tmp/test-build
```

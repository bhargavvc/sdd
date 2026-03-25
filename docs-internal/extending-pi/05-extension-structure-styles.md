# Extension Structure & Styles


### Single File (simplest)

```
~/.sdd/agent/extensions/
└── my-extension.ts
```

### Directory with index.ts (multi-file)

```
~/.sdd/agent/extensions/
└── my-extension/
    ├── index.ts        # Entry point (must export default function)
    ├── tools.ts
    └── utils.ts
```

### Package with Dependencies (npm packages needed)

```
~/.sdd/agent/extensions/
└── my-extension/
    ├── package.json
    ├── package-lock.json
    ├── node_modules/
    └── src/
        └── index.ts
```

```json
// package.json
{
  "name": "my-extension",
  "dependencies": { "zod": "^3.0.0" },
  "pi": { "extensions": ["./src/index.ts"] }
}
```

Run `npm install` in the extension directory. Imports from `node_modules/` resolve automatically.

### Available Imports

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-coding-agent` | Extension types (`ExtensionAPI`, `ExtensionContext`, event types, utilities) |
| `@sinclair/typebox` | Schema definitions for tool parameters (`Type.Object`, `Type.String`, etc.) |
| `@mariozechner/pi-ai` | AI utilities (`StringEnum` for Google-compatible enums) |
| `@mariozechner/pi-tui` | TUI components (`Text`, `Box`, `Container`, `SelectList`, etc.) |
| Node.js built-ins | `node:fs`, `node:path`, `node:child_process`, etc. |

---

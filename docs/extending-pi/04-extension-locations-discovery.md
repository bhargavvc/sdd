# Extension Locations & Discovery


### Auto-Discovery Paths

| Location | Scope |
|----------|-------|
| `~/.sdd/agent/extensions/*.ts` | Global (all projects) |
| `~/.sdd/agent/extensions/*/index.ts` | Global (subdirectory) |
| `.sdd/extensions/*.ts` | Project-local |
| `.sdd/extensions/*/index.ts` | Project-local (subdirectory) |

### Additional Paths (via settings.json)

```json
{
  "extensions": [
    "/path/to/local/extension.ts",
    "/path/to/local/extension/dir"
  ],
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1"
  ]
}
```

### Security Warning

> Extensions run with your **full system permissions**. They can execute arbitrary code, read/write any file, make network requests. Only install from sources you trust.

---

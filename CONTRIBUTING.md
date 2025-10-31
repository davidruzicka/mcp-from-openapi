# Contributing to mcp4openapi

Thank you for considering contributing! This document provides guidelines for developers working on the codebase.

## Development Setup

1. **Clone and install**:
   ```bash
   git clone https://github.com/davidruzicka/mcp4openapi.git
   cd mcp4openapi
   npm install
   ```

2. **Build**:
   ```bash
   npm run build
   ```

3. **Run tests**:
   ```bash
   npm test
   ```

4. **Run with example**:
   ```bash
   export OPENAPI_SPEC_PATH=./profiles/gitlab/openapi.yaml
   export MCP_PROFILE_PATH=./profiles/gitlab/developer-profile.json
   export API_BASE_URL=https://your-gitlab-instance/api/v4
   export API_TOKEN=your-token
   npm start
   ```

## Code Style

- Follow existing TypeScript conventions
- Use meaningful variable names
- Add JSDoc comments for public APIs
- Include "Why" comments for non-obvious decisions

## Testing

- Write tests for new features
- Maintain test coverage above 80%
- Run `npm test` before submitting PR
- Integration tests in `src/testing/`
- Unit tests alongside source files (`*.test.ts`)

## ⚠️ CRITICAL: Profile Schema Synchronization

**When modifying profile schema structure** (adding fields to `ToolDefinition` or `Profile`):

### Three schemas MUST stay in sync:

1. **TypeScript Types** (`src/types/profile.ts`)
   ```typescript
   export interface ToolDefinition {
     // ... existing fields ...
     new_field?: SomeType;
   }
   ```

2. **JSON Schema** (`profile-schema.json`)
   ```json
   {
     "properties": {
       "new_field": {
         "type": "...",
         "description": "..."
       }
     }
   }
   ```

3. **⚠️ Zod Schema** (`src/profile-loader.ts`) - **MOST CRITICAL!**
   ```typescript
   const ToolDefSchema = z.object({
     // ... existing fields ...
     new_field: z.someType().optional(),
   });
   ```

### Why All Three?

- **TypeScript**: Compile-time type checking, IDE support
- **JSON Schema**: Profile validation, IDE auto-complete for JSON files
- **Zod Schema**: **Runtime validation** - missing field = silently dropped!

### Common Bug Pattern

```typescript
// ✅ TypeScript type exists
export interface ToolDefinition {
  response_fields?: Record<string, string[]>;
}

// ✅ JSON Schema exists
{
  "response_fields": { "type": "object" }
}

// ❌ Zod schema MISSING
const ToolDefSchema = z.object({
  // response_fields not listed!
});

// 💥 Result: profile.tools[0].response_fields === undefined at runtime
// Even though TypeScript compiles and JSON validates!
```

### Debugging Checklist

If a profile field is ignored at runtime:

1. ✅ Check TypeScript interface in `src/types/profile.ts`
2. ✅ Check JSON Schema in `profile-schema.json`
3. ⚠️ **Check Zod schema in `src/profile-loader.ts`** ← Most likely culprit!

### Why Zod Breaks Silently

Zod runs in **strict mode** by default:
- Unknown properties are **silently removed** during `parse()`
- No errors, no warnings
- TypeScript is happy (types match)
- JSON validates (schema matches)
- But the field never reaches runtime!

## Architecture Overview

See [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for detailed architecture and design decisions.

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Build (`npm run build`)
6. Commit with clear message
7. Push to your fork
8. Open a Pull Request

## Documentation

When adding features:

- Update relevant docs in `docs/`
- Add examples to profiles if applicable
- Update `IMPLEMENTATION.md` for architectural changes
- Keep `PROFILE-GUIDE.md` in sync with profile schema

## Questions?

- Check [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) for architecture details
- Check [`docs/PROFILE-GUIDE.md`](./docs/PROFILE-GUIDE.md) for profile creation
- Open an issue for discussion

## License

By contributing, you agree that your contributions will be licensed under the MIT License.


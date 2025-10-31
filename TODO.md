# TODO

**Note**: This contains future work (P1/P2/P3).

---

## Contents

- [P1: Performance Improvements](#p1-performance-improvements)
  - [1. Schema $ref Resolution](#1-schema-ref-resolution)
- [P2: Maintenance and Code Quality](#p2-maintenance-and-code-quality)
  - [2. Validate Operations Keys in ProfileLoader](#1-validate-operations-keys-in-profileloader)
- [P3: Nice-to-Have](#p3-nice-to-have)
  - [3. Response Caching](#2-response-caching)
  - [4. Request Deduplication](#3-request-deduplication)
  - [5. Auto-generate Profile from OpenAPI](#4-auto-generate-profile-from-openapi)

## P1: Performance Improvements

### 1. Schema $ref Resolution
**Current**: `extractSchema()` returns `{ type: 'object' }` for all `$ref` schemas.

**Goal**: Fully resolve schema references for accurate type information and validation.

**Implementation**:
- Add `resolveSchema(ref: string): SchemaInfo` similar to `resolveParameter()`
- Recursively resolve nested `$ref`s
- Cache resolved schemas to avoid circular references
- Handle `allOf`, `oneOf`, `anyOf` compositions

**Files to modify**:
- `src/openapi-parser.ts` - implement `resolveSchema()`
- Add circular reference detection (Set of visited refs)

**Estimated effort**: 3-4 hours

## P2: Maintenance and Code Quality

### 2. Validate Operations Keys in ProfileLoader
**Current**: `mapActionToOperation()` composes keys like `${action}_${resourceType}` without validation.

**Goal**: Catch typos at profile load time, not at runtime.

**Implementation**:
- In `ProfileLoader.validateLogic()`, check each key in `tool.operations`:
  - Must match an action in `action.enum`, OR
  - Must match pattern `{action}_{resourceType}` where both are valid enum values
- Provide helpful error: "Invalid operation key 'creat_project'. Did you mean 'create_project'?"

**Files to modify**:
- `src/profile-loader.ts` - add validation to `validateLogic()`

**Estimated effort**: 1-2 hours

## P3: Nice-to-Have

### 3. Response Caching
Add optional caching layer for idempotent GET requests:
```json
{
  "interceptors": {
    "cache": {
      "enabled": true,
      "ttl_seconds": 300,
      "max_entries": 1000
    }
  }
}
```

**Estimated effort**: 3-4 hours

### 4. Request Deduplication
Prevent multiple identical in-flight requests (thundering herd):
- Hash request (method + URL + body)
- If same request is pending, await existing promise
- Return cached result to all callers

**Estimated effort**: 2-3 hours

### 5. Auto-generate Profile from OpenAPI
Command: `mcp4openapi generate-profile --spec=api.yaml --output=profile.json`
- Group operations by tag
- Infer common CRUD patterns
- Generate reasonable tool names and descriptions

**Estimated effort**: 6-8 hours


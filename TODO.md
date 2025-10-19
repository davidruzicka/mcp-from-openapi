# TODO

**Note**: This contains future work (P1/P2/P3).

---

## Contents

- [P1: Performance Improvements](#p1-performance-improvements)
  - [1. Parallel Composite Steps with DAG](#1-parallel-composite-steps-with-dag)
  - [2. Schema $ref Resolution](#2-schema-ref-resolution)
  - [3. Per-Endpoint Rate Limiting](#3-per-endpoint-rate-limiting)
- [P2: Maintenance and Code Quality](#p2-maintenance-and-code-quality)
  - [4. Validate Operations Keys in ProfileLoader](#4-validate-operations-keys-in-profileloader)
  - [5. Structured Error Types](#5-structured-error-types)
- [P3: Nice-to-Have](#p3-nice-to-have)
  - [6. Response Caching](#6-response-caching)
  - [7. Request Deduplication](#7-request-deduplication)
  - [8. Auto-generate Profile from OpenAPI](#8-auto-generate-profile-from-openapi)

## P1: Performance Improvements

### 1. Parallel Composite Steps with DAG
**Current**: All composite steps execute sequentially, even when independent.

**Goal**: Execute independent steps in parallel for better performance.

**Implementation**:
- Add `depends_on: string[]` field to `CompositeStep` in profile schema
- Build dependency graph in `CompositeExecutor.execute()`
- Use topological sort to determine execution order
- Execute steps at same depth level with `Promise.all()`

**Example**:
```json
{
  "steps": [
    { "call": "GET /projects/{id}", "store_as": "project" },
    {
      "call": "GET /projects/{id}/merge_requests",
      "store_as": "merge_requests",
      "depends_on": ["project"]
    },
    {
      "call": "GET /projects/{id}/issues",
      "store_as": "issues",
      "depends_on": ["project"]
    }
  ]
}
```
Steps 2 and 3 can run in parallel since both only depend on step 1.

**Files to modify**:
- `src/types/profile.ts` - add `depends_on` to `CompositeStep`
- `src/profile-loader.ts` - validate DAG (no cycles)
- `src/composite-executor.ts` - implement parallel execution

**Estimated effort**: 4-6 hours

---

### 2. Schema $ref Resolution
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

---

### 3. Per-Endpoint Rate Limiting
**Current**: Single global rate limit for all API calls.

**Goal**: Support different rate limits for different endpoints (e.g., search operations).

**Implementation**:
- Add `rate_limit_overrides` to profile interceptor config:
```json
{
  "interceptors": {
    "rate_limit": {
      "max_requests_per_minute": 600,
      "overrides": {
        "getApiV4Search": {
          "max_requests_per_minute": 60
        }
      }
    }
  }
}
```
- Create separate token bucket for each override
- Match operation ID in interceptor, use appropriate bucket

**Files to modify**:
- `src/types/profile.ts` - add overrides to `RateLimitConfig`
- `src/interceptors.ts` - implement per-operation buckets
- Pass operation ID through request context

**Estimated effort**: 2-3 hours

---

## P2: Maintenance and Code Quality

### 4. Validate Operations Keys in ProfileLoader
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

---

### 5. Structured Error Types
**Current**: Generic `Error` objects with string messages.

**Goal**: Type-safe error handling with machine-readable error codes.

**Implementation**:
```typescript
// src/errors.ts
export class MCPError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MCPError';
  }
}

export class ValidationError extends MCPError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class OperationNotFoundError extends MCPError {
  constructor(operationId: string) {
    super(
      `Operation not found: ${operationId}`,
      'OPERATION_NOT_FOUND',
      { operationId }
    );
    this.name = 'OperationNotFoundError';
  }
}

export class ParameterError extends MCPError {
  constructor(paramName: string, reason: string) {
    super(
      `Invalid parameter '${paramName}': ${reason}`,
      'PARAMETER_ERROR',
      { paramName, reason }
    );
    this.name = 'ParameterError';
  }
}
```

**Files to modify**:
- `src/errors.ts` - new file with error hierarchy
- Replace `throw new Error(...)` throughout codebase
- Update tests to check error types

**Estimated effort**: 2-3 hours

---

## P3: Nice-to-Have

### 6. Response Caching
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

---

### 7. Request Deduplication
Prevent multiple identical in-flight requests (thundering herd):
- Hash request (method + URL + body)
- If same request is pending, await existing promise
- Return cached result to all callers

**Estimated effort**: 2-3 hours

---

### 8. Auto-generate Profile from OpenAPI
Command: `mcp-from-openapi generate-profile --spec=api.yaml --output=profile.json`
- Group operations by tag
- Infer common CRUD patterns
- Generate reasonable tool names and descriptions

**Estimated effort**: 6-8 hours


# TODO

**Note**: This contains future work (P1/P2/P3).

---

## Contents

- [P1: Correctness and Core Features](#p1-correctness-and-core-features)
  - [1. Schema $ref Resolution](#1-schema-ref-resolution)
- [P2: Maintenance and Code Quality](#p2-maintenance-and-code-quality)
  - [2. Validate Operations Keys in ProfileLoader](#2-validate-operations-keys-in-profileloader)
- [P3: Nice-to-Have](#p3-nice-to-have)
  - [3. OpenAPI Operation Filter for Default Profile](#3-openapi-operation-filter-for-default-profile)
  - [4. Response Caching](#4-response-caching)
  - [5. Request Deduplication](#5-request-deduplication)

## P1: Correctness and Core Features

### 1. Schema $ref Resolution
**Current**: `extractSchema()` returns `{ type: 'object' }` for all `$ref` schemas, losing type information.

**Goal**: Fully resolve schema references for accurate type information and validation.

**Impact**: 
- ✅ Better validation (required fields, enums, formats)
- ✅ More accurate auto-generated tool parameters
- ✅ Improved LLM understanding of API structure
- ⚠️ Slightly slower parsing (negligible - happens once at startup)

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

### 3. OpenAPI Operation Filter for Default Profile
**Current**: Without profile, all OpenAPI operations generate tools. Complex APIs may produce 100+ tools with parameter inflation warnings.

**Goal**: Allow filtering operations when auto-generating default profile.

**Implementation Options**:

**Option A: Whitelist (Simple, Recommended for Start)**
```bash
export DEFAULT_PROFILE_ALLOWED_OPERATIONS="getProject,listProjects,createIssue"
```

**Pros**: Simple, deterministic, easy to audit
**Cons**: Requires maintenance when API changes

**Option A2: Regex Whitelist (Flexible)**
```bash
export DEFAULT_PROFILE_OPERATIONS_REGEX="^(get|list|create)"
# Example: only read operations
export DEFAULT_PROFILE_OPERATIONS_REGEX="^(get|list|search)"
# Example: exclude delete operations
export DEFAULT_PROFILE_OPERATIONS_REGEX="^(?!delete)"
```

**Pros**: Flexible, covers operation classes, adapts to API changes
**Cons**: Risk of unintended matches, harder to audit

**Option B: Blacklist (Exclusion-based)**
```bash
export DEFAULT_PROFILE_EXCLUDE_OPERATIONS="deleteProject,deleteIssue"
export DEFAULT_PROFILE_EXCLUDE_TAGS="admin,deprecated"
```

**Pros**: Include most, exclude specific dangerous operations
**Cons**: May miss new dangerous operations

**Option C: Tag-based Filter (Leverages OpenAPI Tags)**
```bash
export DEFAULT_PROFILE_INCLUDE_TAGS="projects,issues,merge_requests"
export DEFAULT_PROFILE_EXCLUDE_TAGS="admin,system"
```

**Pros**: Semantic filtering aligned with API design
**Cons**: Requires well-tagged OpenAPI spec

**Recommendation**: 
- **Production/Security-critical**: Use **Option A (whitelist)** for explicit control
- **Development/Exploration**: Use **Option A2 (regex)** for flexibility
- **Well-documented APIs**: Add **Option C (tag-based)** for semantic filtering
- **Combination**: Support all three simultaneously (whitelist + regex + tags) with precedence: whitelist → regex → tags

**Files to modify**:
- `src/profile-loader.ts` - filter operations in `createDefaultProfile()`
- `README.md` - document env variables

**Estimated effort**: 
- Whitelist: 1 hour
- Regex: 1 hour
- Tag-based: 1-2 hours
- Total (all three): 3-4 hours

### 4. Response Caching
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

### 5. Request Deduplication
Prevent multiple identical in-flight requests (thundering herd):
- Hash request (method + URL + body)
- If same request is pending, await existing promise
- Return cached result to all callers

**Estimated effort**: 2-3 hours


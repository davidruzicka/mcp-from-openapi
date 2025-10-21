# Implementation Summary

## Architecture

```
┌─────────────────┐
│  CLI Entry      │  index.ts - reads env vars, initializes server
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  MCP Server     │  mcp-server.ts - coordinates all components
└────────┬────────┘
         │
         ├──────────► OpenAPI Parser (openapi-parser.ts)
         │            - Loads & indexes OpenAPI spec
         │            - Resolves $ref parameters
         │            - Fast operation lookup
         │
         ├──────────► Profile Loader (profile-loader.ts)
         │            - Validates profile JSON with Zod (auto-generated)
         │            - Checks semantic rules
         │            - Default profile generation
         │            ✅ Zod schemas auto-generated from TypeScript types
         │
         ├──────────► Tool Generator (tool-generator.ts)
         │            - Generates MCP tools from profile
         │            - Creates JSON Schema for parameters
         │            - Validates conditional requirements
         │            - Maps actions to operations
         │
         ├──────────► HTTP Client + Interceptors (interceptors.ts)
         │            - Auth (header/query/bearer from env)
         │            - Rate limiting (token bucket)
         │            - Retry (exponential backoff)
         │            - Fetch wrapper
         │
         └──────────► Composite Executor (composite-executor.ts)
                      - Chains API calls
                      - Merges results into nested structure
                      - Path parameter resolution
```

## Key Design Decisions

### 1. Configuration-Driven Design

**Why**: Same server code works with any API. All customization in profile JSON.

**Implementation**:
- **Parameter Aliases**: Map tool parameters to API path params (e.g., `resource_id` → `{id}`)
- **Metadata Params**: Specify which parameters control tool behavior vs API request
- **Array Format**: Configure array serialization per API (brackets, indices, repeat, comma)
- **Partial Results**: Composite tools can return completed steps even if later steps fail
- **Profile-Aware Token Redaction**: Logger automatically redacts auth tokens based on profile's auth type (bearer/query/custom-header)

**Trade-offs**:
- More upfront configuration vs runtime flexibility
- Validation at profile load time catches errors early
- No hard-coded API assumptions in core code

### 2. Tool Aggregation Strategy

**Why**: Reduce MCP tool count from 200+ to ~5-10

**How**:
- `manage_project_badges` → 5 CRUD operations
- `manage_branches` → 7 operations
- `manage_access_requests` → 8 operations (project + group)

**Trade-off**:
- ✅ 85% reduction in tool count
- ✅ Less context pollution for LLM
- ⚠️ Slightly more complex parameter validation

### 2. Profile-Driven Configuration

**Why**: Same server, different tool surfaces without code changes

**How**: JSON profiles define:
- Which tools to expose
- How actions map to operations
- Resource type discrimination (project/group)
- Interceptor configuration

**Benefits**:
- Admin profile: full access
- Developer profile: read/write, no admin ops
- Readonly profile: only GET operations

### 3. Conditional Parameter Requirements

**Why**: `badge_id` only needed for get/update/delete, not list/create

**How**: `required_for: ["get", "update", "delete"]` in parameter definition

**LLM-friendly**: Description includes: "Required when action is: get, update, delete"

**Validation**: Runtime check in `validateArguments()`

### 4. Interceptor Chain Pattern

**Why**: Separate auth, rate-limiting, retry concerns from business logic

**How**: Middleware pattern with `next()` chain

**Order**: auth → rate-limit → retry → fetch

**Benefits**:
- Each interceptor independently testable
- Easy to add new interceptors (logging, metrics)
- Configuration-driven (no code changes)

### 5. Composite Tools for Reducing Roundtrips

**Why**: Fetching MR + comments + changes requires 3 calls

**How**: `steps` array with `store_as` JSONPath for result aggregation

**Example**:
```json
{
  "steps": [
    { "call": "GET /projects/{id}/merge_requests/{iid}", "store_as": "merge_request" },
    { "call": "GET /projects/{id}/merge_requests/{iid}/notes", "store_as": "merge_request.comments" }
  ]
}
```

**Result**: Single JSON with nested structure

### 6. $ref Resolution in OpenAPI

**Why**: GitLab spec uses shared parameters (`ProjectIdOrPath`)

**How**: `resolveParameter()` looks up in `components.parameters`

**Impact**: Properly extracts `id` path parameter that was previously missed

### 7. Resource Type Discrimination

**Why**: Same operation on different resources (project badges vs group badges)

**How**: `resource_type` parameter + operation mapping:
```json
{
  "operations": {
    "list_project": "getApiV4ProjectsIdBadges",
    "list_group": "getApiV4GroupsIdBadges"
  }
}
```

**Lookup**: `mapActionToOperation()` tries `{action}_{resource_type}` first, falls back to `{action}`

### 8. Token Bucket Rate Limiting

**Why**: Allow bursts while enforcing average rate

**Formula**:
- `tokens = min(max, tokens + elapsed * tokensPerMs)`
- Wait if `tokens < 1`

**Better than**: Simple per-request delays (poor UX, doesn't prevent bursts)

### 9. Exponential Backoff Retry

**Why**: Reduces server load during outages

**How**: `backoff_ms: [1000, 2000, 4000]` - each attempt waits longer

**Retries on**: 429 (rate limit), 502/503/504 (server errors)

**Better than**: Linear backoff (thundering herd problem)

### 10. Dual Transport Support (stdio + HTTP)

**Why**: stdio for local development, HTTP for remote/production access

**stdio**: MCP SDK `StdioServerTransport` for local use

**HTTP Streamable** (MCP Spec 2025-03-26):
- POST `/mcp` - client→server messages (JSON-RPC)
- GET `/mcp` - server→client messages (SSE stream)
- DELETE `/mcp` - session termination
- Session management with UUID, 30min timeout
- SSE resumability via `Last-Event-ID`
- Optional heartbeat for reverse proxy keepalive
- Origin validation (DNS rebinding protection)
- CIDR/wildcard support for corporate networks

**Configured via**: `MCP_TRANSPORT=stdio|http`

## File Structure

```
src/
├── types/
│   ├── profile.ts       - Profile configuration types
│   ├── openapi.ts       - Simplified OpenAPI types
│   └── http-transport.ts - HTTP transport types
├── openapi-parser.ts    - OpenAPI spec parser & indexer
├── profile-loader.ts    - Profile JSON loader & validator
├── tool-generator.ts    - MCP tool generator
├── interceptors.ts      - HTTP interceptor chain
├── composite-executor.ts - Multi-step API call executor
├── schema-validator.ts  - Request body validation
├── http-transport.ts    - HTTP Streamable transport (787 lines)
├── metrics.ts           - Prometheus metrics collector (264 lines)
├── logger.ts            - Pluggable logger (console/JSON)
├── constants.ts         - Time & HTTP status constants
├── mcp-server.ts        - Main MCP server
├── index.ts             - CLI entry point
└── *.test.ts            - Test suites (144 tests)

profiles/examples/gitlab/
├── openapi.yaml         - GitLab OpenAPI spec
└── developer-profile.json - Example profile

scripts/
├── validate-profile.ts  - Profile validation CLI
└── validate-schema.ts   - Schema meta-validation

docs/
├── HTTP-TRANSPORT.md    - HTTP transport guide (603 lines)
└── PROFILE-GUIDE.md     - Profile creation guide (622 lines)
```

## Test Coverage (152 tests, 100% passing)

✅ **Unit Tests** (103 tests):
- **OpenAPI Parser** (8 tests) - spec parsing, $ref resolution
- **Profile Loader** (4 tests) - validation, logic checks
- **Tool Generator** (7 tests) - MCP tool generation, JSON schema
- **Interceptors** (10 tests) - auth, rate-limit, retry, array serialization
- **Composite Executor** (6 tests) - multi-step execution, partial results
- **Schema Validator** (9 tests) - request body validation
- **Logger** (17 tests) - console/JSON output, log levels, **profile-aware token redaction** (bearer/query/custom-header)
- **HTTP Transport** (35 tests) - POST/GET/DELETE, sessions, SSE, origin validation, CIDR
- **Metrics** (16 tests) - HTTP, sessions, tools, API calls

✅ **Integration Tests** (30 tests):
- **GitLab API** (21 tests) - badges, branches, access requests, jobs
- **HTTP Protocol** (9 tests) - full request/response cycle, tool execution

✅ **Validation Tests** (19 tests):
- **Profile Schema** (10 tests) - JSON Schema validation, compilation
- **Validation CLI** (9 tests) - profile validation script

## Performance Characteristics

**Startup**:
- OpenAPI parsing: ~500ms for GitLab spec (3600 lines)
- Profile loading: ~20ms
- Index building: O(n) where n = number of operations

**Runtime**:
- Operation lookup: O(1) via Map
- Parameter validation: O(p) where p = number of parameters
- Interceptor overhead: ~2-5ms (auth + rate-limit check)

**Memory**:
- OpenAPI index: ~1MB for GitLab spec
- Negligible for profile config

## Known Limitations

1. **$ref Resolution**: Schema $refs not fully resolved (parameters are handled)
2. **Pagination**: No auto-pagination yet (would require detecting Link headers)
3. **Response Validation**: Doesn't validate response bodies against OpenAPI schemas (only requests)
4. **IPv6 CIDR**: Origin validation supports only IPv4 CIDR ranges
5. **Parallel Composite Steps**: All steps execute sequentially (no DAG-based parallelization yet)

## Production Readiness

### ✅ P0 Features (Complete)

**1. Pluggable Logger**
- `Logger` interface with `ConsoleLogger` and `JsonLogger`
- Log levels: DEBUG, INFO, WARN, ERROR, SILENT
- Structured logging with context
- Environment-driven configuration (`LOG_LEVEL`, `LOG_FORMAT`)
- **Profile-aware token redaction**: Automatically redacts auth tokens (bearer/query/custom-header) based on profile configuration

**2. Configuration Over Hard-coding**
- Parameter aliases in profile (no hard-coded `resource_id`, `project_id`)
- Metadata params per tool (not global defaults)
- Array format per API (brackets, indices, repeat, comma)

**3. Partial Results**
- Composite tools support `partial_results: true`
- Returns completed steps + errors even if later steps fail
- `_metadata` includes success status, error details

**4. Schema Validation**
- Request body validated against OpenAPI schema
- Type checking, required fields, enum values, nested objects, arrays
- Format validation (email, URI)
- Clear error messages with JSONPath

### ✅ HTTP Transport (Complete)

**MCP Specification 2025-03-26 Compliant**
- POST/GET/DELETE endpoints
- Session management (UUID, timeout, cleanup)
- SSE streaming with resumability (`Last-Event-ID`)
- Origin validation with CIDR/wildcard support
- Optional heartbeat for reverse proxies
- Health endpoint (`/health`)
- Configurable via environment variables

**Security**:
- DNS rebinding protection
- Localhost-only by default
- CIDR ranges for corporate networks
- Wildcard subdomains (`*.company.com`)
- Session timeout enforcement

### ✅ Prometheus Metrics (Complete)

**Metrics Endpoint** (`/metrics`):
- HTTP requests (total, duration, by method/path/status)
- Sessions (active, created, destroyed)
- Tool calls (total, duration, errors, by tool/status)
- API calls (total, duration, errors, by operation/status)

**Features**:
- Configurable enable/disable (`METRICS_ENABLED`)
- Custom metrics path (`METRICS_PATH`)
- Path normalization (prevents high cardinality)
- Status grouping (2xx, 4xx, 5xx)
- Prometheus-compatible format

**Integration**:
- Grafana-ready
- Prometheus scrape endpoint
- Production observability

## Future Enhancements

See [TODO.md](./TODO.md) for detailed implementation plans.

**Future Ideas**:
- Auto-pagination (follow `Link` headers)
- Breaking change detection (compare OpenAPI versions)
- Mock server generator from OpenAPI spec
- LLM-based smart routing
- Response validation against schemas
- IPv6 CIDR support for origin validation

## Why This Works

1. **LLM-Friendly**:
   - Clear tool names (`manage_project_badges` not `badge_ops`)
   - Rich descriptions with use-case hints
   - Explicit conditional requirements in descriptions

2. **Fast**:
   - Upfront indexing trades startup time for O(1) lookups
   - Token bucket allows bursts without API violations

3. **Maintainable**:
   - Separation of concerns (parser, loader, generator, executor)
   - Each component independently testable
   - Config-driven (profile changes don't need code deploy)

4. **Flexible**:
   - Works with any OpenAPI 3.x spec
   - Profile system enables unlimited customization
   - Interceptors extensible without touching core logic

5. **Proven Pattern**:
   - Based on youtrack-mcp aggregation approach
   - MCP SDK handles protocol complexity
   - Standard TypeScript tooling (Vitest, Zod, ESLint)

## Schema Synchronization (Critical!)

**Three schema systems must stay in sync:**

1. **TypeScript Types** (`src/types/profile.ts`)
   - IDE support, compile-time type checking
   - Used by all TypeScript code

2. **JSON Schema** (`profile-schema.json`)
   - Profile file validation
   - IDE auto-complete in JSON editors
   - Used by `npm run validate`

3. **Zod Schemas** (`src/generated-schemas.ts`)
   - **Auto-generated runtime validation and parsing**
   - **✅ Generated from TypeScript types via `npm run generate-schemas`**
   - Used during profile loading

**Why Zod can break your features:**
- Zod runs in **strict mode** by default
- Unknown properties are **silently removed** during `parse()`
- Even if TypeScript and JSON Schema are correct, missing Zod field = feature doesn't work

**Debugging checklist:**
1. Profile field works in tests but not runtime? → Run `npm run generate-schemas`
2. TypeScript happy but feature broken? → Run `npm run generate-schemas`
3. JSON validates but field is undefined? → Run `npm run generate-schemas`


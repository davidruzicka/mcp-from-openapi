# MCP from OpenAPI

Universal MCP server that generates tools from any OpenAPI specification.

## Why This Project?

Transform any OpenAPI specification into MCP tools **without writing code**. Configure everything via profiles, reduce LLM context pollution, and get production-ready features out of the box.

## Key Features

### Core
- **Any OpenAPI API**: Works with OpenAPI 3.x specifications
- **Tool Aggregation**: Reduce tool clutter - group related operations
- **Composite Actions**: Chain API calls into workflows
- **Profiles**: Create JSON configuration for different use cases (admin/developer/readonly/custom)

### Production Ready
- **Dual Transport**: stdio (local) or HTTP streaming (remote) - switch via env variable
- **Session Management**: Stateful HTTP sessions with automatic cleanup
- **Security**: Origin validation, localhost-first, configurable auth
- **Resilience**: Rate limiting, retry with backoff, partial results for composite actions
- **Observability**: Structured logging (console/JSON) with profile-aware token redaction, Prometheus metrics

### Developer Experience
- **Type-safe**: Full TypeScript (almost) with strict mode
- **Well documented**: Guides, examples, inline comments
- **Mock server**: Test without real API access

## Use Cases

1. **Less Context Pollution**: Fewer tools with filtered response fields = more relevant context for LLM
2. **Multi-Environment**: Same server, different profiles (dev/staging/prod)
3. **Custom Workflows**: Composite tools for common multi-step operations
4. **Any API**: Works with any OpenAPI 3.x specification

## Quick Start

### Option A: npx (Fastest)

No installation required:

```bash
npx mcp4openapi
```

### Option B: npm (Recommended)

Install globally:

```bash
npm install -g mcp4openapi
mcp4openapi
```

### Option C: Docker

**1. Build image:**
```bash
docker build -t mcp4openapi .
```

**2. Run with docker-compose:**
```bash
# Copy and edit environment file
cp .env.example .env
# Edit .env with your API_TOKEN (for stdio) and API_BASE_URL and other settings

# Start server
docker-compose --env-file .env up -d

# Check health
curl http://localhost:3003/health
```

See [docs/DOCKER.md](./docs/DOCKER.md) for authentication modes, production deployment, and security.

## Local Development

**1. Clone & Install:**
```bash
git clone https://github.com/davidruzicka/mcp4openapi.git
cd mcp4openapi
npm install
```

**2. Build:**
```bash
npm run build
```

**3. Configure:**
```bash
cp .env.example .env
# Edit .env with your settings
```

**4. Run:**
```bash
npm start
```

See [docs/HTTP-TRANSPORT.md](./docs/HTTP-TRANSPORT.md) for transport options (stdio vs HTTP) and authentication modes.

## Environment Variables

### Required
- `OPENAPI_SPEC_PATH`: Path to OpenAPI spec (YAML/JSON)
- `API_TOKEN`: API token (default env var name; customizable via `AUTH_ENV_VAR`)
  - **Required for stdio** mode with authenticated APIs
  - **Optional for HTTP** mode with per-session tokens
  - When using no profile mode, auth type is auto-detected from OpenAPI `security` schemes

### Optional - Core
- `MCP_PROFILE_PATH`: Profile JSON path (default: auto-generate tools from OpenAPI spec; warning logged if tool exceeds 60 parameters)
- `MCP_TRANSPORT`: `stdio` (default) or `http`
- `API_BASE_URL`: Override OpenAPI server URL

### Optional - Authentication (No-Profile Mode)
When running without a profile, authentication is automatically configured from OpenAPI spec's `security` schemes:

- `AUTH_ENV_VAR`: Environment variable name for auth token (default: `API_TOKEN`)

**Supported OpenAPI Security Types:**
- **Bearer Token** (`http` with `scheme: bearer`): Uses `Authorization: Bearer <token>` header
- **API Key in Header** (`apiKey` with `in: header`): Uses custom header (e.g., `X-API-Key: <token>`)
- **API Key in Query** (`apiKey` with `in: query`): Adds token to query string (e.g., `?api_key=<token>`)
- **OAuth2/OpenID Connect**: Mapped to bearer token authentication
- **Public APIs**: No authentication if OpenAPI spec has no `security` defined

**Example**: Use custom env var for GitLab token:
```bash
export AUTH_ENV_VAR=GITLAB_TOKEN
export GITLAB_TOKEN=glpat-xxxxxxxxxxxx
export OPENAPI_SPEC_PATH=./openapi.yaml
npm start
```

#### Force Authentication Override
For APIs with incomplete OpenAPI specs (missing `security` definition but requiring authentication):

- `AUTH_FORCE`: Enable force auth override (`true|false`, default: `false`)
- `AUTH_TYPE`: Authentication type: `bearer|query|custom-header` (default: `bearer`)
- `AUTH_HEADER_NAME`: Custom header name (required when `AUTH_TYPE=custom-header`)
- `AUTH_QUERY_PARAM`: Query parameter name (required when `AUTH_TYPE=query`)

**Example**: Force bearer authentication for incomplete spec:
```bash
export AUTH_FORCE=true
export AUTH_TYPE=bearer
export API_TOKEN=your_token_here
export OPENAPI_SPEC_PATH=./incomplete-spec.yaml
npm start
```

**Example**: Force custom header authentication:
```bash
export AUTH_FORCE=true
export AUTH_TYPE=custom-header
export AUTH_HEADER_NAME=X-API-Key
export API_TOKEN=your_api_key_here
npm start
```

**Note**: If OpenAPI spec has `security` defined, it takes precedence over force auth settings.

### Optional - Tool Name Shortening
When generating tools from OpenAPI without a profile, long operation IDs may exceed limits. Configure automatic shortening:

- `MCP_TOOLNAME_MAX`: Maximum tool name length (default: `45`)
- `MCP_TOOLNAME_STRATEGY`: Shortening strategy: `none|balanced|iterative|hash|auto` (default: `none`)
  - `none`: No shortening, only warnings
  - `balanced`: Add parts by importance until unique & meaningful (recommended, min 3 parts, 20 chars)
  - `iterative`: Progressively remove noise until under limit (conservative)
  - `hash`: Use verb + resource + hash for guaranteed uniqueness
  - `auto`: Try strategies in order: balanced → iterative → hash
- `MCP_TOOLNAME_WARN_ONLY`: Only warn, don't shorten: `true|false` (default: `true`)
- `MCP_TOOLNAME_MIN_PARTS`: Minimum parts for balanced strategy (default: `3`)
- `MCP_TOOLNAME_MIN_LENGTH`: Minimum length in chars for balanced strategy (default: `20`)

**Example**: Apply balanced shortening (recommended):
```bash
export MCP_TOOLNAME_STRATEGY=balanced
export MCP_TOOLNAME_WARN_ONLY=false
```

**Result** for balanced strategy:
```
putApiV4ProjectsIdAlertManagementAlertsAlertIidMetricImagesMetricImageId
    → put_alert_management_image (26 chars)
deleteApiV4ProjectsIdAlertManagementAlertsAlertIidMetricImagesMetricImageId
    → delete_alert_management_image (26 chars)
```

**Example**: Apply iterative shortening with 30 char limit:
```bash
export MCP_TOOLNAME_STRATEGY=iterative
export MCP_TOOLNAME_WARN_ONLY=false
export MCP_TOOLNAME_MAX=30
```

### Optional - HTTP Transport
- `MCP_HOST`: Bind address (default: `127.0.0.1`; warning logged if non-localhost with empty `ALLOWED_ORIGINS`)
- `MCP_PORT`: Port (default: `3003`)
- `ALLOWED_ORIGINS`: Comma-separated origins (default: empty; supports exact, wildcard `*.domain.com`, CIDR `192.168.1.0/24`)
- `SESSION_TIMEOUT_MS`: Session timeout (default: `1800000` = 30min)
- `HEARTBEAT_ENABLED`: SSE heartbeat (default: `false`)
- `HEARTBEAT_INTERVAL_MS`: Heartbeat interval (default: `30000` = 30s)

### Optional - Observability
- `LOG_LEVEL`: `debug`, `info` (default), `warn`, `error`
- `LOG_FORMAT`: `console` (default) or `json`
- `METRICS_ENABLED`: Enable Prometheus metrics (default: `false`)
- `METRICS_PATH`: Metrics endpoint (default: `/metrics`)

**Security Note**: 
- Sensitive auth tokens are automatically redacted from logs based on your profile's auth configuration (bearer, query, or custom-header)
- All errors returned to clients are sanitized to generic messages (`Internal error`) while full details are logged server-side

## Profile System

Profiles define which MCP tools to expose and how to aggregate them. **Start with existing profiles** from `profiles/` (e.g., GitLab).

**Features:**
- Tool aggregation (group related operations)
- Response field filtering (reduce LLM context)
- Composite actions (chain API calls)
- Rate limiting & retry logic

**Create your own profiles**: See [docs/PROFILE-GUIDE.md](./docs/PROFILE-GUIDE.md)

## Testing & Validation

### Validate Profile
```bash
npm run validate
# Checks: JSON syntax, schema, logic, OpenAPI operations
```

### Validate Schema
```bash
npm run validate:schema
# Validates profile-schema.json itself
```

### Run Tests
```bash
npm test
```

## Documentation

- **[docs/EXAMPLE-GITLAB.md](./docs/EXAMPLE-GITLAB.md)** - Complete GitLab API example with curl commands
- **[docs/PROFILE-GUIDE.md](./docs/PROFILE-GUIDE.md)** - Guide for creating custom profiles
- **[docs/HTTP-TRANSPORT.md](./docs/HTTP-TRANSPORT.md)** - HTTP transport setup and usage
- **[USAGE.md](./USAGE.md)** - General usage guide
- **`profiles/examples/`** - Example profiles for GitLab API
- **`profiles/profile-schema.json`** - JSON Schema for IDE autocomplete

## Project Status

- Core MCP server with tool generation
- stdio transport (MCP SDK)
- HTTP Streamable transport (MCP Spec 2025-03-26)
- Session management & SSE resumability
- Profile system with validation
- Prometheus metrics (HTTP, sessions, tools, API calls)

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for development guidelines.

## License

[MIT](./LICENSE.md)

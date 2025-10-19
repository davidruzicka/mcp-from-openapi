# MCP from OpenAPI

Universal MCP server that generates tools from any OpenAPI specification.

## Why This Project?

Transform any OpenAPI specification into MCP tools **without writing code**. Configure everything via profiles, reduce LLM context pollution, and get production-ready features out of the box.

## Key Features

### Core
- **Any OpenAPI API**: Works with OpenAPI 3.x specifications
- **Tool Aggregation**: Reduce tool clutter - group related operations (e.g., `manage_badges` instead of 5 separate tools)
- **Composite Actions**: Chain API calls into workflows (fetch merge request + comments + attachments as one)
- **Profiles**: JSON configuration for different use cases (admin/developer/readonly/custom)

### Production Ready
- **Dual Transport**: stdio (local) or HTTP streaming (remote) - switch via env variable
- **Session Management**: Stateful HTTP sessions with automatic cleanup
- **Security**: Origin validation, localhost-first, configurable auth
- **Resilience**: Rate limiting, retry with backoff, partial results for composite actions
- **Observability**: Structured logging (console/JSON) with profile-aware token redaction, Prometheus metrics

### Developer Experience
- **152 tests passing** (104 unit + 48 integration) - 100% pass rate
- **Type-safe**: Full TypeScript with strict mode
- **Well documented**: Guides, examples, inline comments
- **Mock server**: Test without real API access

## Use Cases

1. **Less Context Pollution**: Fewer tools = more relevant context for LLM
2. **Multi-Environment**: Same server, different profiles (dev/staging/prod)
3. **Custom Workflows**: Composite tools for common multi-step operations
4. **Any API**: Works with any OpenAPI 3.x specification

## Quick Start

### Option A: Docker (Recommended)

**1. Build image:**
```bash
docker build -t mcp-from-openapi .
```

**2. Run with docker-compose:**
```bash
# Copy and edit environment file
cp .env.example .env
# Edit .env with your API_TOKEN and API_BASE_URL

# Start server
docker-compose --env-file .env up -d

# Check health
curl http://localhost:3003/health
```

**3. Or run with docker:**
```bash
docker run -d \
  -p 3003:3003 \
  -v $(pwd)/profiles:/app/profiles:ro \
  -e OPENAPI_SPEC_PATH=/app/profiles/gitlab/openapi.yaml \
  -e MCP_PROFILE_PATH=/app/profiles/gitlab/developer-profile.json \
  -e API_TOKEN=your_token \
  -e API_BASE_URL=https://api.example.com \
  mcp-from-openapi
```

See [docs/DOCKER.md](./docs/DOCKER.md) for production deployment, security, monitoring.

### Option B: Local Development

**1. Install & Build:**
```bash
npm install
npm run build
```

**2. Configure:**
```bash
cp .env.example .env
# Edit .env with your settings
```

**3. Run:**
```bash
# stdio transport (local)
npm start

# HTTP transport (remote)
export MCP_TRANSPORT=http
npm start
```

## Transport Options

### stdio Transport (Local)
Best for: MCP desktop clients, local development

**Native:**
```bash
export MCP_TRANSPORT=stdio
npm start
```

**Pros**: Simple, secure, no network configuration
**Cons**: Single local client only

### HTTP Transport (Remote)
Best for: Remote access, multiple clients, load balancing, Docker

**Docker (recommended):**
```bash
docker-compose up -d
# Access at http://localhost:3003
```

**Native:**
```bash
export MCP_TRANSPORT=http
export MCP_HOST=127.0.0.1      # or 0.0.0.0 for network access
export MCP_PORT=3003
npm start
```

**Features**:
- MCP Specification 2025-03-26 compliant
- SSE streaming with resumability
- Session management with auto-cleanup
- Origin validation (DNS rebinding protection)
- Optional heartbeat for proxy keepalive

**Documentation**:
- [docs/HTTP-TRANSPORT.md](./docs/HTTP-TRANSPORT.md) - HTTP protocol guide
- [docs/DOCKER.md](./docs/DOCKER.md) - Docker deployment guide

## Environment Variables

### Required
- `OPENAPI_SPEC_PATH`: Path to OpenAPI spec (YAML/JSON)
- `API_TOKEN`: API authentication token

### Optional - Core
- `MCP_PROFILE_PATH`: Profile JSON path (default: all tools defined from OpenAPI spec)
- `MCP_TRANSPORT`: `stdio` (default) or `http`
- `API_BASE_URL`: Override OpenAPI server URL

### Optional - HTTP Transport
- `MCP_HOST`: Bind address (default: `127.0.0.1`)
- `MCP_PORT`: Port (default: `3003`)
- `ALLOWED_ORIGINS`: Comma-separated origins (supports exact, wildcard `*.domain.com`, CIDR `192.168.1.0/24`)
- `SESSION_TIMEOUT_MS`: Session timeout (default: `1800000` = 30min)
- `HEARTBEAT_ENABLED`: SSE heartbeat (default: `false`)
- `HEARTBEAT_INTERVAL_MS`: Heartbeat interval (default: `30000` = 30s)

### Optional - Observability
- `LOG_LEVEL`: `debug`, `info` (default), `warn`, `error`
- `LOG_FORMAT`: `console` (default) or `json`

**Security Note**: Sensitive auth tokens are automatically redacted from logs based on your profile's auth configuration (bearer, query, or custom-header).
- `METRICS_ENABLED`: Enable Prometheus metrics (default: `false`)
- `METRICS_PATH`: Metrics endpoint (default: `/metrics`)

## Profile System

Profiles define which MCP tools to expose and how to aggregate them.

### Structure

```json
{
  "$schema": "../../../profile-schema.json",
  "name": "developer-profile",
  "description": "Tools for developers",
  "tools": [
    {
      "name": "manage_badges",
      "description": "Manage project badges",
      "operations": {
        "list": "listProjectBadges",
        "get": "getProjectBadge",
        "create": "createProjectBadge",
        "update": "updateProjectBadge",
        "delete": "deleteProjectBadge"
      }
    }
  ],
  "interceptors": {
    "auth": {
      "type": "bearer",
      "variable_name": "API_TOKEN"
    },
    "rate_limit": {
      "requests_per_second": 10
    }
  }
}
```

### Profile Features

- **Parameter Aliases**: Map `id` → `project_id`, `group_id`, etc.
- **Metadata Params**: Exclude `action`, `resource_type` from API requests
- **Array Format**: Configure query param serialization (`brackets`, `indices`, `repeat`, `comma`)
- **Partial Results**: Composite tools can return partial data on step failures

See `profiles/examples/` for complete examples.

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

## License

[MIT](./LICENSE.md)

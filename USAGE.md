# Usage Guide

For a complete working example with GitLab API, see [EXAMPLE-GITLAB.md](./EXAMPLE-GITLAB.md).

## Quick Start

### stdio Transport (Single-user, Local)

1. **Setup environment:**

```bash
export OPENAPI_SPEC_PATH=./path/to/openapi.yaml
export MCP_PROFILE_PATH=./profiles/your-profile.json
export MCP_TRANSPORT=stdio
export API_TOKEN=your_token_here
export API_BASE_URL=https://api.example.com
```

2. **Build and run:**

```bash
npm install
npm run build
npm start
```

### HTTP Transport (Multi-user, Remote)

1. **Setup environment (no API_TOKEN):**

```bash
export OPENAPI_SPEC_PATH=./path/to/openapi.yaml
export MCP_PROFILE_PATH=./profiles/your-profile.json
export MCP_TRANSPORT=http
export MCP_HOST=0.0.0.0
export MCP_PORT=3003
export API_BASE_URL=https://api.example.com
# No API_TOKEN - clients send tokens in headers
```

2. **Build and run:**

```bash
npm install
npm run build
npm start
```

3. **Client sends token during initialization:**

```bash
curl -X POST http://localhost:3003/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -H "Authorization: Bearer your_user_token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

## Example Tool Calls

For complete GitLab API examples, see [EXAMPLE-GITLAB.md](./EXAMPLE-GITLAB.md).

### Generic Examples

#### List Resources

```json
{
  "name": "manage_resources",
  "arguments": {
    "resource_id": "my-resource",
    "action": "list",
    "page": 1,
    "per_page": 20
  }
}
```

### Create Project Badge

```json
{
  "name": "manage_project_badges",
  "arguments": {
    "project_id": "123",
    "action": "create",
    "link_url": "https://example.com/coverage",
    "image_url": "https://shields.io/badge/coverage-95%25-green",
    "name": "Coverage Badge"
  }
}
```

### List Branches

```json
{
  "name": "manage_branches",
  "arguments": {
    "project_id": "123",
    "action": "list",
    "search": "feature/",
    "sort": "updated_desc"
  }
}
```

### Create Branch

```json
{
  "name": "manage_branches",
  "arguments": {
    "project_id": "123",
    "action": "create",
    "branch": "feature/new-feature",
    "ref": "main"
  }
}
```

### Protect Branch

```json
{
  "name": "manage_branches",
  "arguments": {
    "project_id": "123",
    "action": "protect",
    "branch": "main",
    "developers_can_push": false,
    "developers_can_merge": true
  }
}
```

### List Project Access Requests

```json
{
  "name": "manage_access_requests",
  "arguments": {
    "resource_type": "project",
    "resource_id": "123",
    "action": "list"
  }
}
```

### Approve Access Request

```json
{
  "name": "manage_access_requests",
  "arguments": {
    "resource_type": "project",
    "resource_id": "123",
    "action": "approve",
    "user_id": 123,
    "access_level": 30
  }
}
```

Access levels:
- `10` = Guest
- `20` = Reporter
- `30` = Developer (default)
- `40` = Maintainer
- `50` = Owner

### List CI/CD Jobs

```json
{
  "name": "list_project_jobs",
  "arguments": {
    "project_id": "123",
    "scope": ["failed", "canceled"]
  }
}
```

### Get Job Details

```json
{
  "name": "manage_job",
  "arguments": {
    "project_id": "123",
    "action": "get",
    "job_id": 12345
  }
}
```

### Trigger Manual Job

```json
{
  "name": "manage_job",
  "arguments": {
    "project_id": "123",
    "action": "play",
    "job_id": 12345
  }
}
```

## Creating Custom Profiles

Create a JSON file with your tool definitions:

```json
{
  "profile_name": "my-custom-profile",
  "description": "Custom tools for my API",
  "tools": [
    {
      "name": "manage_resources",
      "description": "Manage resources with CRUD operations. Actions: 'list', 'get', 'create', 'update', 'delete'.",
      "operations": {
        "list": "operationId_for_list",
        "get": "operationId_for_get",
        "create": "operationId_for_create",
        "update": "operationId_for_update",
        "delete": "operationId_for_delete"
      },
      "parameters": {
        "action": {
          "type": "string",
          "enum": ["list", "get", "create", "update", "delete"],
          "description": "Operation to perform",
          "required": true
        },
        "id": {
          "type": "string",
          "description": "Resource ID",
          "required_for": ["get", "update", "delete"]
        }
      }
    }
  ],
  "interceptors": {
    "auth": {
      "type": "header",
      "header_name": "Authorization",
      "value_from_env": "API_TOKEN"
    },
    "base_url": {
      "value_from_env": "API_BASE_URL",
      "default": "https://api.example.com"
    },
    "rate_limit": {
      "max_requests_per_minute": 60
    },
    "retry": {
      "max_attempts": 3,
      "backoff_ms": [1000, 2000, 4000],
      "retry_on_status": [429, 502, 503, 504]
    }
  }
}
```

## Composite Tools (Advanced)

Create tools that chain multiple API calls:

```json
{
  "name": "get_merge_request_full",
  "description": "Get MR with comments and changes",
  "composite": true,
  "steps": [
    {
      "call": "GET /projects/{project_id}/merge_requests/{merge_request_iid}",
      "store_as": "merge_request"
    },
    {
      "call": "GET /projects/{project_id}/merge_requests/{merge_request_iid}/notes",
      "store_as": "merge_request.comments"
    },
    {
      "call": "GET /projects/{project_id}/merge_requests/{merge_request_iid}/changes",
      "store_as": "merge_request.changes"
    }
  ],
  "parameters": {
    "project_id": {
      "type": "string",
      "description": "Project ID",
      "required": true
    },
    "merge_request_iid": {
      "type": "integer",
      "description": "MR IID",
      "required": true
    }
  }
}
```

Result structure:
```json
{
  "merge_request": {
    "id": 123,
    "title": "feat: ...",
    "comments": [...],
    "changes": [...]
  }
}
```

## Troubleshooting

### Authentication Errors

Ensure `API_TOKEN` is set:
```bash
export API_TOKEN=xxxxxxxxxxxxxxxxxxxx
```

### Rate Limiting

If you hit rate limits, adjust in profile:
```json
"rate_limit": {
  "max_requests_per_minute": 300
}
```

### Missing Parameters

Check tool description for `required_for` hints:
- "Required when action is: create, update"

### OpenAPI Spec Not Found

Verify path:
```bash
ls -la $OPENAPI_SPEC_PATH
```

## Integration with MCP Clients

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "node",
      "args": ["/path/to/mcp-from-openapi/dist/index.js"],
      "env": {
        "OPENAPI_SPEC_PATH": "your-openapi-spec-path.yaml",
        "MCP_PROFILE_PATH": "your-profile-path.json",
        "API_TOKEN": "your_token",
        "API_BASE_URL": "https://your_api_base_url"
      }
    }
  }
}
```

### Cursor IDE

Similar configuration in MCP settings.

### Containerized Deployment

See [docs/DOCKER.md](./docs/DOCKER.md) for containerized deployment.

## Performance Tips

1. **Profile Optimization**: Only include tools you need
2. **Rate Limiting**: Set appropriate limits for your API plan
3. **Caching**: OpenAPI spec is parsed once at startup
4. **Composite Tools**: Reduce roundtrips for common workflows


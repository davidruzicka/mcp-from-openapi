# GitLab API Example

Complete working example using MCP server with GitLab API.

## Results

For GitLab API specifically:
- Reduced from 200+ potential tools to 5 aggregated tools
- 85% reduction in MCP tool count
- Tested with real GitLab OpenAPI specification

## Setup

### 1. Get GitLab API Token

Visit https://gitlab.com/-/user_settings/personal_access_tokens and create a token with appropriate scopes.

### 2. Configure Environment

**Option A: Using .env file (recommended)**

```bash
cp .env.example .env
# Edit .env and set:
#   OPENAPI_SPEC_PATH=profiles/examples/gitlab/openapi.yaml
#   MCP_PROFILE_PATH=profiles/examples/gitlab/developer-profile.json
#   API_TOKEN=your_gitlab_token_here
```

**Option B: Using environment variables**

```bash
export OPENAPI_SPEC_PATH=profiles/examples/gitlab/openapi.yaml
export MCP_PROFILE_PATH=profiles/examples/gitlab/developer-profile.json
export MCP_TRANSPORT=stdio
export API_TOKEN=your_gitlab_token_here
export API_BASE_URL=https://gitlab.com/api/v4
```

### 3. Run

```bash
npm install
npm run build
npm start
```

Or use the provided script:

```bash
# Edit example-run.sh with your token
./example-run.sh
```

## Available Tools

The `profiles/examples/gitlab/developer-profile.json` profile provides 5 aggregated tools:

### 1. manage_project_badges

Manage badges for a project (list, get, create, update, delete).

Example:
```json
{
  "project_id": "my-org/my-project",
  "action": "list"
}
```

### 2. manage_branches

Manage repository branches (list, get, create, delete, protect, unprotect, exists).

Example:
```json
{
  "project_id": "my-org/my-project",
  "action": "create",
  "branch": "feature/new-feature",
  "ref": "main"
}
```

### 3. manage_access_requests

Manage access requests for projects or groups (list, approve, deny, request).

Example:
```json
{
  "resource_type": "project",
  "resource_id": "my-org/my-project",
  "action": "list"
}
```

### 4. list_project_jobs

List CI/CD jobs for a project with optional status filtering.

Example:
```json
{
  "project_id": "my-org/my-project",
  "scope": ["failed", "canceled"]
}
```

### 5. manage_job

Manage a specific CI/CD job (get details, play manual job).

Example:
```json
{
  "project_id": "my-org/my-project",
  "action": "get",
  "job_id": 1234
}
```

## Profile Configuration

The `gitlab-developer.json` profile includes:

### Interceptors

- **Auth**: Token header from `API_TOKEN`
- **Base URL**: Configurable via `API_BASE_URL`
- **Rate Limit**: 600 requests/minute (token bucket)
- **Retry**: 3 attempts with exponential backoff [1s, 2s, 4s]
- **Retry Status Codes**: 429, 502, 503, 504

### Tool Aggregation Strategy

Each tool groups related operations:

- `manage_project_badges`: 5 CRUD operations
- `manage_branches`: 7 branch operations
- `manage_access_requests`: 8 operations (project + group variants)
- `list_project_jobs`: 1 operation with filtering
- `manage_job`: 2 operations (get, play)

Total: 23 operations aggregated into 5 tools (78% reduction).

## Testing

The project includes integration tests using a mock GitLab server:

```bash
npm test
```

Tests cover:
- All 5 tools
- CRUD operations
- Error scenarios (404, 403)
- Query parameter handling
- Resource type discrimination

## Claude Desktop Integration

Add to your `mcp.json`:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "node",
      "args": ["/path/to/mcp-from-openapi/dist/index.js"],
      "env": {
        "OPENAPI_SPEC_PATH": "/path/to/profiles/examples/gitlab/openapi.yaml",
        "MCP_PROFILE_PATH": "/path/to/profiles/examples/gitlab/developer-profile.json",
        "API_TOKEN": "glpat-xxxxxxxxxxxxxxxxxxxx",
        "API_BASE_URL": "https://gitlab.com/api/v4"
      }
    }
  }
}
```

For self-hosted GitLab:

```json
{
  "API_BASE_URL": "https://gitlab.yourcompany.com/api/v4"
}
```

## Common Use Cases

### Check Failed CI Jobs

```json
{
  "tool": "list_project_jobs",
  "arguments": {
    "project_id": "my-org/my-project",
    "scope": ["failed"]
  }
}
```

### Create Feature Branch

```json
{
  "tool": "manage_branches",
  "arguments": {
    "project_id": "my-org/my-project",
    "action": "create",
    "branch": "feature/implement-x",
    "ref": "main"
  }
}
```

### Approve Access Request

```json
{
  "tool": "manage_access_requests",
  "arguments": {
    "resource_type": "project",
    "resource_id": "my-org/my-project",
    "action": "approve",
    "user_id": 123,
    "access_level": 30
  }
}
```

Access levels:
- 10 = Guest
- 20 = Reporter
- 30 = Developer (default)
- 40 = Maintainer
- 50 = Owner

## Troubleshooting

### Authentication Errors

Verify your token (`read_user` right is required):
```bash
curl -H "Authorization: Bearer $API_TOKEN" https://gitlab.com/api/v4/user
```

### Rate Limiting

If hitting rate limits, adjust in profile:
```json
{
  "interceptors": {
    "rate_limit": {
      "max_requests_per_minute": 300
    }
  }
}
```

### Self-Hosted GitLab

Ensure API is accessible and use correct base URL:
```bash
export API_BASE_URL=https://gitlab.yourcompany.com/api/v4
```

## Creating Custom Profiles

You can create additional profiles for different use cases:

- `profiles/examples/gitlab/admin-profile.json` - Include admin operations
- `profiles/examples/gitlab/readonly-profile.json` - Only GET operations
- `profiles/examples/gitlab/ci-profile.json` - Focus on CI/CD operations

See `profiles/examples/gitlab/developer-profile.json` as a template and `profile-schema.json` for the JSON schema.

## OpenAPI Specification

The `profiles/examples/gitlab/openapi.yaml` file is a partial GitLab API specification used for testing.

For complete GitLab API documentation, see:
https://docs.gitlab.com/ee/api/

To update the specification:
1. Download from GitLab repository
2. Place in `profiles/examples/gitlab/` directory as `openapi.yaml`
3. Rebuild profile if adding new operations


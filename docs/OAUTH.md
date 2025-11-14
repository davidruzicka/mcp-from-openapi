# OAuth 2.0 Authentication Guide

This guide explains how to configure OAuth 2.0 authentication for mcp4openapi.

## Overview

OAuth 2.0 support enables browser-based authentication flow instead of manually managing API tokens:

- **Traditional**: Copy Personal Access Token → Paste into env var → Restart server
- **With OAuth**: Click "Connect" → Authorize in browser → Done

**Important**: OAuth is only available in **HTTP transport mode**. Stdio transport requires static tokens.

## Supported Flow

- **Authorization Code Flow with PKCE** (RFC 7636)
- Works with GitLab, GitHub, and any OAuth 2.0-compliant provider
- Secure: tokens handled by OAuth provider, not exposed in config files

## Setup: GitLab Example

### 1. Register OAuth Application in GitLab

1. Log into your GitLab instance (e.g., `https://www.gitlab.com`)
2. Go to **User Settings** → **Applications**
3. Click **Add new application**
4. Fill in:
   - **Name**: `MCP Server` (or any name)
   - **Redirect URI**: `http://<mcp-server-url:port>/oauth/callback`
     - Must match `redirect_uri` in your profile
     - Port must match `MCP_PORT` environment variable
   - **Scopes**: Select required permissions:
     - `api` - Full API access
     - `read_user` - Read user profile
     - `read_repository` - Read repositories
5. Click **Save application**
6. **Copy** the generated **Application ID** and **Secret**

### 2. Configure Environment Variables

Create or edit `~/.env.mcp` (for Cursor remote) or set in your shell:

```bash
# OAuth Configuration
GITLAB_OAUTH_AUTHORIZATION_URL=https://www.gitlab.com/oauth/authorize
GITLAB_OAUTH_TOKEN_URL=https://www.gitlab.com/oauth/token
GITLAB_OAUTH_CLIENT_ID=your_application_id_here
GITLAB_OAUTH_CLIENT_SECRET=your_secret_here

# API Configuration
API_BASE_URL=https://www.gitlab.com/api/v4

# Transport Configuration
MCP_TRANSPORT=http
MCP_HOST=<mcp-server-url>
MCP_PORT=<mcp-server-port>
```

**Security Note**: Never commit `client_secret` to version control. Use environment variables or secret management tools.

### 3. Create OAuth Profile

Use the example profile `profiles/gitlab/oauth-profile.json`:

```json
{
  "$schema": "../../profile-schema.json",
  "profile_name": "gitlab-oauth",
  "description": "GitLab API with OAuth 2.0 authentication",
  "tools": [
    {
      "name": "manage_projects",
      "description": "Manage GitLab projects",
      "operations": {
        "list": "getApiV4Projects",
        "get": "getApiV4ProjectsId"
      },
      "parameters": {
        "action": {
          "type": "string",
          "enum": ["list", "get"],
          "required": true
        }
      }
    }
  ],
  "interceptors": {
    "auth": {
      "type": "oauth",
      "oauth_config": {
        "authorization_endpoint": "${env:GITLAB_OAUTH_AUTHORIZATION_URL}",
        "token_endpoint": "${env:GITLAB_OAUTH_TOKEN_URL}",
        "client_id": "${env:GITLAB_OAUTH_CLIENT_ID}",
        "client_secret": "${env:GITLAB_OAUTH_CLIENT_SECRET}",
        "scopes": ["api", "read_repository"],
        "redirect_uri": "http://<mcp-server-url:port>/oauth/callback"
      }
    }
  }
}
```

### 4. Configure MCP Client

**Cursor (`.cursor/mcp.json`):**

```json
{
  "mcpServers": {
    "gitlab-oauth": {
      "command": "npx",
      "args": ["mcp4openapi"],
      "env": {
        "OPENAPI_SPEC_PATH": "profiles/gitlab/openapi.yaml",
        "MCP_PROFILE_PATH": "profiles/gitlab/oauth-profile.json",
        "MCP_TRANSPORT": "http",
        "MCP_HOST": "<mcp-server-url>",
        "MCP_PORT": "<mcp-server-port>",
        "API_BASE_URL": "${env:API_BASE_URL}",
        "GITLAB_OAUTH_AUTHORIZATION_URL": "${env:GITLAB_OAUTH_AUTHORIZATION_URL}",
        "GITLAB_OAUTH_TOKEN_URL": "${env:GITLAB_OAUTH_TOKEN_URL}",
        "GITLAB_OAUTH_CLIENT_ID": "${env:GITLAB_OAUTH_CLIENT_ID}",
        "GITLAB_OAUTH_CLIENT_SECRET": "${env:GITLAB_OAUTH_CLIENT_SECRET}"
      }
    }
  }
}
```

### 5. Start Server

```bash
npm run build
npm start
```

The server will log:

```
OAuth provider initialized
OAuth routes registered
MCP server running on HTTP localhost:3003
```

### 6. Connect from Client

1. In your IDE (Cursor/VS Code), the MCP server will appear
2. Click **"Connect"** or attempt to use a tool
3. Your browser will open to GitLab authorization page
4. Click **"Authorize"** to grant permissions
5. Browser will redirect back to `http://<mcp-server-url:port>/oauth/callback`
6. Connection established! You can now use MCP tools

## OAuth Endpoints

When OAuth is enabled, the following endpoints are available:

### Discovery Endpoints

- **`/.well-known/oauth-authorization-server`** - OAuth server metadata
- **`/.well-known/oauth-protected-resource`** - Protected resource metadata

### OAuth Flow Endpoints

- **`/oauth/authorize`** - Authorization endpoint (redirects to external OAuth provider)
- **`/oauth/token`** - Token exchange endpoint
- **`/oauth/revoke`** - Token revocation endpoint
- **`/oauth/register`** - Dynamic client registration (RFC 7591)

### MCP Endpoints

- **`POST /mcp`** - MCP requests (requires OAuth token)
- **`GET /mcp`** - SSE streaming (requires OAuth token)
- **`DELETE /mcp`** - Session termination

## Advanced Configuration

### Custom Redirect URI

If you need a different callback URL:

```json
{
  "auth": {
    "type": "oauth",
    "oauth_config": {
      "redirect_uri": "http://<mcp-server-url:port>/callback",
      ...
    }
  }
}
```

**Important**: Update redirect URI in GitLab application settings to match.

### Additional OAuth Endpoints

Optional endpoints for advanced features:

```json
{
  "oauth_config": {
    ...
    "introspection_endpoint": "https://www.gitlab.com/oauth/introspect",
    "revocation_endpoint": "https://www.gitlab.com/oauth/revoke",
    "registration_endpoint": "https://www.gitlab.com/oauth/register"
  }
}
```

### Multiple Scopes

Request specific permissions:

```json
{
  "oauth_config": {
    "scopes": ["api", "read_repository"]
  }
}
```

**GitLab Scopes:**
- `api` - Full API access
- `read_user` - Read user profile
- `read_api` - Read-only API access
- `read_repository` - Read repositories
- `write_repository` - Write repositories
- `read_registry` - Read container registry
- `write_registry` - Write container registry
- `sudo` - Perform API actions as any user (admin only)

See [GitLab OAuth documentation](https://docs.gitlab.com/ee/api/oauth2.html) for full scope list.

## Troubleshooting

### "Redirect URI mismatch"

**Cause**: Redirect URI in profile doesn't match GitLab application settings.

**Fix**:
1. Check `redirect_uri` in your profile
2. Ensure it matches exactly in GitLab application settings
3. Port must match `MCP_PORT` environment variable

### "Client authentication failed"

**Cause**: Invalid `client_id` or `client_secret`.

**Fix**:
1. Verify Application ID and Secret from GitLab
2. Check environment variables are set correctly
3. Ensure no extra spaces or quotes in env var values

### "Authorization failed: insufficient scopes"

**Cause**: Requested scopes not granted in GitLab application.

**Fix**:
1. Edit GitLab application
2. Enable required scopes
3. Re-authorize in browser

### Browser doesn't open

**Cause**: MCP client doesn't support OAuth or browser not accessible.

**Fix**:
- OAuth requires HTTP transport mode
- Ensure browser is accessible from the host running MCP server
- Check MCP client logs for OAuth redirect URL
- Manually open the authorization URL in browser

### "OAuth authentication not supported in InterceptorChain"

**Cause**: Trying to use OAuth in stdio transport mode.

**Fix**: OAuth only works in HTTP transport. Set `MCP_TRANSPORT=http` in environment.

## Security Best Practices

### 1. Protect Client Secret

- Never commit to version control
- Use environment variables or secret managers
- Rotate secrets periodically

### 2. Limit Scopes

Request only necessary permissions:

```json
{
  "scopes": ["read_api", "read_repository"]  // Read-only
}
```

### 3. Use HTTPS in Production

For production deployments:

```json
{
  "oauth_config": {
    "redirect_uri": "https://mcp.example.com/oauth/callback"
  }
}
```

### 4. Configure Allowed Origins

Prevent CSRF attacks:

```bash
export ALLOWED_ORIGINS="https://cursor.com,https://your-client.com"
```

### 5. Enable Rate Limiting

Rate limiting is enabled by default. Adjust if needed:

```bash
export HTTP_RATE_LIMIT_ENABLED=true
export HTTP_RATE_LIMIT_MAX_REQUESTS=100  # requests per minute
```

## Comparison: OAuth vs Static Token

| Feature | Static Token | OAuth |
|---------|-------------|-------|
| Setup Complexity | Low (copy/paste) | Medium (OAuth app registration) |
| User Experience | Manual token management | Browser-based authorization |
| Token Expiration | Manual refresh | Automatic refresh |
| Revocation | Revoke in GitLab | Revoke via API or GitLab |
| Security | Token in env var | Token managed by OAuth provider |
| Transport Support | stdio + HTTP | **HTTP only** |

## Next Steps

- **GitHub OAuth**: Similar setup with GitHub OAuth apps
- **Custom OAuth Provider**: Adapt for your OAuth 2.0 provider
- **Auto-detection from OpenAPI**: Future enhancement to detect OAuth from `securitySchemes`

## References

- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
- [PKCE RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)
- [GitLab OAuth2 Documentation](https://docs.gitlab.com/ee/api/oauth2.html)
- [MCP Authentication Specification](https://modelcontextprotocol.io)

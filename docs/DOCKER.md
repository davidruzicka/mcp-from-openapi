# Docker Deployment Guide

Run MCP from OpenAPI server in an isolated Docker container.

## Quick Start

### 1. Build Image

```bash
docker build -t mcp4openapi .
```

### 2. Choose Authentication Mode

**Single-user mode** (simple, one token for all):
```bash
cp .env.docker.example .env.docker
# Edit .env.docker with API_TOKEN
```

**Multi-user mode** (each user sends own token):
```bash
# No .env.docker needed - tokens sent in HTTP headers
```

### 3. Run Container

**Option A: Using docker-compose (recommended)**

Single-user mode:
```bash
docker-compose --env-file .env.docker up -d
```

Multi-user mode:
```bash
# Edit docker-compose.yml to remove API_TOKEN
docker-compose up -d
```

**Option B: Using docker run**

Single-user mode:
```bash
docker run -d \
  --name mcp-server \
  -p 3003:3003 \
  -v $(pwd)/profiles:/app/profiles:ro \
  -e OPENAPI_SPEC_PATH=/app/profiles/gitlab/openapi.yaml \
  -e MCP_PROFILE_PATH=/app/profiles/gitlab/developer-profile.json \
  -e API_TOKEN=your_token \
  -e API_BASE_URL=https://gitlab.com/api/v4 \
  mcp4openapi:latest
```

Multi-user mode:
```bash
docker run -d \
  --name mcp-server \
  -p 3003:3003 \
  -v $(pwd)/profiles:/app/profiles:ro \
  -e OPENAPI_SPEC_PATH=/app/profiles/gitlab/openapi.yaml \
  -e MCP_PROFILE_PATH=/app/profiles/gitlab/developer-profile.json \
  -e API_BASE_URL=https://gitlab.com/api/v4 \
  -e MCP_TRANSPORT=http \
  -e MCP_HOST=0.0.0.0 \
  mcp4openapi:latest
# Clients send: Authorization: Bearer <user_token>
```

### 4. Connect to the Server

VSCode+Copilot example:

```json
{
    "servers": {
        "mcp4openapi": {
            "url": "https://mcp-server.example.com/mcp",
            "headers": {
                "Authorization": "Bearer ${API_TOKEN}"
            }
        },
        "inputs": [
            {
                "type": "promptString",
                "id": "api_token",
                "description": "API Authorization Token",
                "password": true
            }
        ]
    }
}
```

Cursor example:

```json
{
    "mcpServers": {
        "mcp4openapi": {
            "url": "https://mcp-server.example.com/mcp",
            "headers": {
                "Authorization": "Bearer ${API_TOKEN}"
            }
        }
    }
}
```

Claude Code example:

```bash
claude mcp add --transport http secure-api https://mcp-server.example.com/mcp --header "Authorization: Bearer ${API_TOKEN}"
# expects API_TOKEN environment variable to be set
```

IntelliJ+Copilot (HTTP transport) example:

```json
{
    "servers": {
        "mcp4openapi": {
            "url": "https://mcp-server.example.com/mcp",
            "requestInit": {
                "headers": {
                    "Authorization": "Bearer ${API_TOKEN}"
                }
            }
        }
    }
}
```

### 5. Verify

```bash
# Check health
curl http://localhost:3003/health

# Check logs
docker-compose logs -f mcp-server
```

## Multi-stage Build

The Dockerfile uses multi-stage build for:
- **Smaller image size**: Only production dependencies in final image
- **Faster builds**: Better layer caching
- **Security**: Non-root user, minimal attack surface

**Image sizes**:
- Builder stage: ~500 MB
- Final image: ~200 MB

## Configuration

### Environment Variables

All standard environment variables are supported.

### Volume Mounts

**Profiles** (required):
```bash
-v $(pwd)/profiles:/app/profiles:ro
```

**Custom OpenAPI specs** (optional):
```bash
-v $(pwd)/specs:/app/specs:ro
```

## Security

### Non-root User

Container runs as user `mcp` (UID 1000, GID 1000):
```dockerfile
USER mcp
```

**Why UID 1000?** Matches default host user (most Linux distros), avoiding permission issues with mounted volumes. No need to `chown` files on host.

### Network Exposure

**Default**: Binds to `0.0.0.0:3003` for container networking
**Production**: Use reverse proxy (nginx, Traefik) for SSL/TLS

### Secrets Management

**Option 1: Docker secrets** (Docker Swarm)
```yaml
secrets:
  - api_token

secrets:
  api_token:
    external: true
```

**Option 2: Environment file**
```bash
docker run --env-file .env.docker ...
```

**Option 3: Kubernetes secrets**
```yaml
env:
  - name: API_TOKEN
    valueFrom:
      secretKeyRef:
        name: mcp-secrets
        key: api-token
```

## Health Check

Built-in health check every 30 seconds:
```bash
# Check container health
docker ps

# Manual health check
curl http://localhost:3003/health
```

## Resource Limits

Set in `docker-compose.yml`:
```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 512M
    reservations:
      cpus: '0.5'
      memory: 256M
```

## Monitoring

### Logs

**Structured JSON logs** (default):
```bash
docker-compose logs -f mcp-server | jq .
```

**Console logs**:
```yaml
environment:
  - LOG_FORMAT=console
```

### Metrics

Enable Prometheus metrics:
```yaml
environment:
  - METRICS_ENABLED=true
```

Access metrics:
```bash
curl http://localhost:3003/metrics
```

### Prometheus Integration

Uncomment prometheus service in `docker-compose.yml`:
```yaml
prometheus:
  image: prom/prometheus:latest
  ports:
    - "9090:9090"
  volumes:
    - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
```

Create `prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'mcp-server'
    static_configs:
      - targets: ['mcp-server:3003']
    metrics_path: '/metrics'
    scrape_interval: 15s
```

## Production Deployment

### 1. Reverse Proxy (nginx)

```nginx
server {
    listen 443 ssl http2;
    server_name mcp.example.com;

    ssl_certificate /etc/ssl/certs/mcp.crt;
    ssl_certificate_key /etc/ssl/private/mcp.key;

    location / {
        proxy_pass http://mcp-server:3003;
        proxy_http_version 1.1;
        
        # SSE support
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        
        # Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Enable heartbeat for reverse proxies:
```yaml
environment:
  - HEARTBEAT_ENABLED=true
  - HEARTBEAT_INTERVAL_MS=30000
```

### 2. Docker Swarm

```bash
docker stack deploy -c docker-compose.yml mcp-stack
```

### 3. Kubernetes

See `k8s/` directory for manifests (to be created).

## Troubleshooting

### Container won't start

**Check logs**:
```bash
docker-compose logs mcp-server
```

**Common issues**:
- Missing `API_TOKEN` environment variable
- Invalid `OPENAPI_SPEC_PATH` or `MCP_PROFILE_PATH`
- Profiles directory not mounted

### Permission denied

**Ensure volume permissions**:
```bash
chmod -R 755 profiles/
```

### Health check failing

**Manual test**:
```bash
docker exec mcp-server wget -O- http://localhost:3003/health
```

### High memory usage

**Reduce limits in docker-compose.yml**:
```yaml
deploy:
  resources:
    limits:
      memory: 256M
```

## Development

### Hot reload (not supported)

For development, run locally:
```bash
npm run dev
```

### Build without cache

```bash
docker build --no-cache -t mcp4openapi .
```

### Multi-platform build

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t mcp4openapi \
  .
```

## Examples

### Minimal Setup

```bash
docker run -d \
  -p 3003:3003 \
  -v $(pwd)/profiles:/app/profiles:ro \
  -e OPENAPI_SPEC_PATH=/app/profiles/gitlab/openapi.yaml \
  -e MCP_PROFILE_PATH=/app/profiles/gitlab/developer-profile.json \
  -e API_TOKEN=$GITLAB_TOKEN \
  mcp4openapi
```

### Production Setup

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### With Metrics

```bash
docker-compose --env-file .env.docker up -d
# Access Prometheus at http://localhost:9090
# Access metrics at http://localhost:3003/metrics
```

## CI/CD Integration

### GitHub Actions

```yaml
- name: Build Docker image
  run: docker build -t mcp4openapi:${{ github.sha }} .

- name: Push to registry
  run: |
    docker tag mcp4openapi:${{ github.sha }} registry.example.com/mcp:latest
    docker push registry.example.com/mcp:latest
```

### GitLab CI

```yaml
build:
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
```

## Best Practices

1. **Use specific tags**: `mcp4openapi:v1.0.0` not `latest`
2. **Limit resources**: Set CPU/memory limits
3. **Health checks**: Always configure health checks
4. **Structured logs**: Use JSON format for log aggregation
5. **Secrets**: Never commit `.env.docker` to git
6. **Updates**: Rebuild image regularly for security patches
7. **Monitoring**: Enable metrics in production
8. **Backups**: Volume data if using local storage

## References

- [Dockerfile best practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
- [Docker Compose documentation](https://docs.docker.com/compose/)
- [Multi-stage builds](https://docs.docker.com/build/building/multi-stage/)



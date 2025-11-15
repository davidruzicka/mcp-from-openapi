# Production Deployment: MCP GitLab Server s OAuth v Kubernetes

Kompletní návod pro nasazení MCP serveru s OAuth 2.0 autentizací do Kubernetes pro sdílené použití v týmu.

## Přehled

- **MCP Server**: `https://mcp-gitlab.ai.iszn.cz/mcp`
- **GitLab Instance**: `https://gitlab.seznam.net/`
- **OAuth Flow**: Browser-based authorization pro každého uživatele
- **Transport**: HTTP (OAuth vyžaduje HTTP endpoints)

## Architektura

```
┌─────────────────────────────────────────────┐
│  Cursor/VS Code (na PC uživatele)          │
│  - Klikne "Connect"                         │
│  - Otevře browser pro OAuth                 │
└──────────────────┬──────────────────────────┘
                   │ HTTPS
                   v
┌─────────────────────────────────────────────┐
│  Kubernetes Ingress (TLS termination)       │
│  https://mcp-gitlab.ai.iszn.cz              │
└──────────────────┬──────────────────────────┘
                   │
                   v
┌─────────────────────────────────────────────┐
│  MCP Server Service (ClusterIP)             │
│  - HTTP transport na portu 3003             │
│  - OAuth provider adapter                   │
└──────────────────┬──────────────────────────┘
                   │
                   v
┌─────────────────────────────────────────────┐
│  GitLab OAuth Provider                      │
│  https://gitlab.seznam.net/oauth/*          │
└─────────────────────────────────────────────┘
```

## Krok 1: Registrace OAuth aplikace v GitLabu

**Pro administrátora GitLabu:**

1. Přihlaste se na `https://gitlab.seznam.net/`
2. **Admin Area** → **Applications** (nebo pro skupinu: **Group Settings** → **Applications**)
3. **Add new application**:
   ```
   Name: MCP GitLab Server (Production)
   Redirect URI: https://mcp-gitlab.ai.iszn.cz/oauth/authorize
   Confidential: ✓ (checked)
   Scopes:
     ✓ api - Full API access
     ✓ read_repository - Read repositories
   ```
4. **Save application**
5. **Zkopíruj**:
   - **Application ID** (client_id)
   - **Secret** (client_secret)

⚠️ **Poznámka k Redirect URI:**
- MCP SDK vyžaduje callback na `/oauth/authorize` (ne `/oauth/callback`)
- Musí být HTTPS v produkci
- Musí přesně odpovídat URL serveru

## Krok 2: Kubernetes Resources

### 2.1 Namespace

```yaml
# namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: mcp-gitlab
```

### 2.2 Secret pro OAuth Credentials

```yaml
# secret.yaml
apiVersion: v1
kind: Secret
metadata:
  name: mcp-gitlab-oauth
  namespace: mcp-gitlab
type: Opaque
stringData:
  GITLAB_OAUTH_CLIENT_ID: "your_application_id_here"
  GITLAB_OAUTH_CLIENT_SECRET: "your_secret_here"
  GITLAB_OAUTH_AUTHORIZATION_URL: "https://gitlab.seznam.net/oauth/authorize"
  GITLAB_OAUTH_TOKEN_URL: "https://gitlab.seznam.net/oauth/token"
  GITLAB_OAUTH_REDIRECT_URI: "https://mcp-gitlab.ai.iszn.cz/oauth/callback"
  API_BASE_URL: "https://gitlab.seznam.net/api/v4"
```

⚠️ **Bezpečnost**: Necommituj secret do gitu! Použij:
- Sealed Secrets
- External Secrets Operator
- Vault
- Nebo vytvoř secret ručně: `kubectl create secret generic ...`

### 2.3 ConfigMap pro Profile

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mcp-gitlab-profile
  namespace: mcp-gitlab
data:
  oauth-profile.json: |
    {
      "$schema": "../../profile-schema.json",
      "profile_name": "gitlab-oauth-production",
      "description": "GitLab API with OAuth 2.0 for team collaboration",
      "parameter_aliases": {
        "id": ["project_id", "group_id", "user_id", "resource_id"]
      },
      "tools": [
        {
          "name": "manage_groups",
          "description": "Work with GitLab groups. Actions: 'list' (all groups), 'get' (group details), 'list_projects' (projects in group), 'list_subgroups' (subgroups of group).",
          "operations": {
            "list": "getApiV4Groups",
            "get": "getApiV4GroupsId",
            "list_projects": "getApiV4GroupsIdProjects",
            "list_subgroups": "getApiV4GroupsIdSubgroups"
          },
          "metadata_params": ["action"],
          "parameters": {
            "action": {
              "type": "string",
              "enum": ["list", "get", "list_projects", "list_subgroups"],
              "description": "Action to perform",
              "required": true
            },
            "group_id": {
              "type": "string",
              "description": "Group ID (numeric or short name)",
              "required_for": ["get", "list_projects", "list_subgroups"]
            },
            "search": {
              "type": "string",
              "description": "Search query"
            }
          }
        },
        {
          "name": "manage_projects",
          "description": "Work with GitLab projects. Actions: 'list' (all projects), 'get' (project details).",
          "operations": {
            "list": "getApiV4Projects",
            "get": "getApiV4ProjectsId"
          },
          "metadata_params": ["action"],
          "parameters": {
            "action": {
              "type": "string",
              "enum": ["list", "get"],
              "description": "Action to perform",
              "required": true
            },
            "project_id": {
              "type": "string",
              "description": "Project ID (numeric or URL-encoded path)",
              "required_for": ["get"]
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
            "scopes": ["api", "read_user"],
            "redirect_uri": "${env:GITLAB_OAUTH_REDIRECT_URI}"
          }
        },
        "base_url": {
          "value_from_env": "API_BASE_URL",
          "default": "https://gitlab.seznam.net/api/v4"
        },
        "rate_limit": {
          "max_requests_per_minute": 600
        },
        "retry": {
          "max_attempts": 3,
          "backoff_ms": [1000, 2000, 4000],
          "retry_on_status": [429, 502, 503, 504]
        },
        "array_format": "brackets"
      }
    }
  openapi.yaml: |
    # Include GitLab OpenAPI spec here or mount from another source
    # Pro produkci doporučuji stáhnout z https://gitlab.seznam.net/-/api/openapi.yaml
```

⚠️ **OpenAPI Spec**: Pokud je velká, použij separate ConfigMap nebo volume mount ze shared storage.

### 2.4 Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-gitlab
  namespace: mcp-gitlab
spec:
  replicas: 2  # Pro high availability
  selector:
    matchLabels:
      app: mcp-gitlab
  template:
    metadata:
      labels:
        app: mcp-gitlab
    spec:
      containers:
      - name: mcp-server
        image: your-registry/mcp4openapi:latest  # Build vlastní image
        ports:
        - containerPort: 3003
          name: http
        env:
        # Transport configuration
        - name: MCP_TRANSPORT
          value: "http"
        - name: MCP_HOST
          value: "0.0.0.0"  # Bind na všechny interfaces v kontejneru
        - name: MCP_PORT
          value: "3003"
        
        # OAuth credentials (from Secret)
        - name: GITLAB_OAUTH_CLIENT_ID
          valueFrom:
            secretKeyRef:
              name: mcp-gitlab-oauth
              key: GITLAB_OAUTH_CLIENT_ID
        - name: GITLAB_OAUTH_CLIENT_SECRET
          valueFrom:
            secretKeyRef:
              name: mcp-gitlab-oauth
              key: GITLAB_OAUTH_CLIENT_SECRET
        - name: GITLAB_OAUTH_AUTHORIZATION_URL
          valueFrom:
            secretKeyRef:
              name: mcp-gitlab-oauth
              key: GITLAB_OAUTH_AUTHORIZATION_URL
        - name: GITLAB_OAUTH_TOKEN_URL
          valueFrom:
            secretKeyRef:
              name: mcp-gitlab-oauth
              key: GITLAB_OAUTH_TOKEN_URL
        - name: GITLAB_OAUTH_REDIRECT_URI
          valueFrom:
            secretKeyRef:
              name: mcp-gitlab-oauth
              key: GITLAB_OAUTH_REDIRECT_URI
        - name: API_BASE_URL
          valueFrom:
            secretKeyRef:
              name: mcp-gitlab-oauth
              key: API_BASE_URL
        
        # Profile configuration
        - name: MCP_PROFILE_PATH
          value: "/config/oauth-profile.json"
        - name: OPENAPI_SPEC_PATH
          value: "/config/openapi.yaml"
        
        # Security & Performance
        - name: ALLOWED_ORIGINS
          value: "https://mcp-gitlab.ai.iszn.cz"
        - name: HTTP_RATE_LIMIT_ENABLED
          value: "true"
        - name: HTTP_RATE_LIMIT_MAX_REQUESTS
          value: "200"  # Pro více uživatelů
        - name: SESSION_TIMEOUT_MS
          value: "3600000"  # 1 hodina
        
        # Logging & Metrics
        - name: LOG_LEVEL
          value: "info"
        - name: LOG_FORMAT
          value: "json"
        - name: METRICS_ENABLED
          value: "true"
        
        volumeMounts:
        - name: config
          mountPath: /config
          readOnly: true
        
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        
        livenessProbe:
          httpGet:
            path: /health
            port: 3003
          initialDelaySeconds: 10
          periodSeconds: 30
        
        readinessProbe:
          httpGet:
            path: /health
            port: 3003
          initialDelaySeconds: 5
          periodSeconds: 10
        
        securityContext:
          allowPrivilegeEscalation: false
          runAsNonRoot: true
          runAsUser: 1000
          capabilities:
            drop:
            - ALL
      
      volumes:
      - name: config
        configMap:
          name: mcp-gitlab-profile
```

### 2.5 Service

```yaml
# service.yaml
apiVersion: v1
kind: Service
metadata:
  name: mcp-gitlab
  namespace: mcp-gitlab
spec:
  type: ClusterIP
  ports:
  - port: 80
    targetPort: 3003
    protocol: TCP
    name: http
  selector:
    app: mcp-gitlab
```

### 2.6 Ingress (s TLS)

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mcp-gitlab
  namespace: mcp-gitlab
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"  # Nebo váš issuer
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
    # CORS pro MCP clients
    nginx.ingress.kubernetes.io/enable-cors: "true"
    nginx.ingress.kubernetes.io/cors-allow-origin: "https://mcp-gitlab.ai.iszn.cz"
    nginx.ingress.kubernetes.io/cors-allow-credentials: "true"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - mcp-gitlab.ai.iszn.cz
    secretName: mcp-gitlab-tls
  rules:
  - host: mcp-gitlab.ai.iszn.cz
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mcp-gitlab
            port:
              number: 80
```

## Krok 3: Build Docker Image

### 3.1 Dockerfile (production)

```dockerfile
# Dockerfile.production
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY profiles/ ./profiles/
COPY profile-schema.json ./
COPY scripts/ ./scripts/

# Build
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy built files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/profiles ./profiles
COPY --from=builder /app/profile-schema.json ./

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "require('http').get('http://localhost:3003/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Non-root user
RUN addgroup -g 1000 mcpserver && \
    adduser -D -u 1000 -G mcpserver mcpserver && \
    chown -R mcpserver:mcpserver /app

USER mcpserver

EXPOSE 3003

CMD ["node", "dist/src/index.js"]
```

### 3.2 Build & Push

```bash
# Build image
docker build -f Dockerfile.production -t your-registry/mcp4openapi:latest .

# Push to registry
docker push your-registry/mcp4openapi:latest
```

## Krok 4: Deploy do Kubernetes

```bash
# Apply všechny resources
kubectl apply -f namespace.yaml
kubectl apply -f secret.yaml
kubectl apply -f configmap.yaml
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl apply -f ingress.yaml

# Ověř deployment
kubectl -n mcp-gitlab get pods
kubectl -n mcp-gitlab logs -f deployment/mcp-gitlab

# Ověř ingress
kubectl -n mcp-gitlab get ingress
```

## Krok 5: Konfigurace pro Uživatele

### Pro Cursor (✅ OAuth podporováno)

Každý kolega si přidá do `.cursor/mcp.json` (v home directory: `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "gitlab-production": {
      "url": "https://mcp-gitlab.ai.iszn.cz/mcp"
    }
  }
}
```

**To je vše!** Žádné tokeny, žádné credentials.

### Pro VS Code

V `.vscode/mcp.json` nebo `~/.config/Code/User/mcp.json`:

```json
{
  "servers": {
    "gitlab-production": {
      "url": "https://mcp-gitlab.ai.iszn.cz/mcp"
    }
  }
}
```

✅ **Cursor automaticky detekuje OAuth** z `/.well-known/oauth-authorization-server` a zobrazí tlačítko "Connect"

### OAuth Flow pro Uživatele

1. Uživatel otevře Cursor/VS Code
2. V MCP section uvidí "gitlab-production" server
3. **Zobrazí se tlačítko "Connect"** (Cursor detekuje OAuth automaticky)
4. Uživatel klikne → otevře se browser na `https://mcp-gitlab.ai.iszn.cz/oauth/authorize`
5. Server přesměruje na: `https://gitlab.seznam.net/oauth/authorize?...`
6. Uživatel se přihlásí do GitLabu a klikne "Authorize"
7. GitLab přesměruje zpět na: `https://mcp-gitlab.ai.iszn.cz/oauth/authorize?code=...`
8. MCP server vymění code za access token
9. **Uživatel je připojen** - může používat GitLab tools! 🎉

⚠️ **Každý uživatel má vlastní OAuth session** - tokeny nejsou sdílené mezi uživateli.

## Krok 6: Monitoring & Troubleshooting

### 6.1 Metrics (Prometheus)

```yaml
# servicemonitor.yaml (pro Prometheus Operator)
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: mcp-gitlab
  namespace: mcp-gitlab
spec:
  selector:
    matchLabels:
      app: mcp-gitlab
  endpoints:
  - port: http
    path: /metrics
    interval: 30s
```

### 6.2 Logs

```bash
# Real-time logs
kubectl -n mcp-gitlab logs -f deployment/mcp-gitlab

# Filter OAuth logs
kubectl -n mcp-gitlab logs deployment/mcp-gitlab | grep -i oauth

# Check errors
kubectl -n mcp-gitlab logs deployment/mcp-gitlab | grep -i error
```

### 6.3 Debug OAuth Issues

**Test OAuth endpoints:**

```bash
# Check OAuth metadata
curl https://mcp-gitlab.ai.iszn.cz/.well-known/oauth-authorization-server

# Check health
curl https://mcp-gitlab.ai.iszn.cz/health
```

**Common Issues:**

1. **"Redirect URI mismatch"**
   - Zkontroluj, že v GitLab aplikaci je: `https://mcp-gitlab.ai.iszn.cz/oauth/callback`
   - Zkontroluj v profile: `"redirect_uri": "${env:GITLAB_OAUTH_REDIRECT_URI}"`
   - Zkontroluj env var: `export GITLAB_OAUTH_REDIRECT_URI=https://mcp-gitlab.ai.iszn.cz/oauth/callback`

2. **"Client authentication failed"**
   - Ověř CLIENT_ID a CLIENT_SECRET v secretu
   - Check logs: `kubectl logs deployment/mcp-gitlab`

3. **CORS errors**
   - Zkontroluj `ALLOWED_ORIGINS` v deployment
   - Zkontroluj ingress annotations

4. **SSL/TLS issues**
   - Ověř cert-manager
   - Check TLS secret: `kubectl -n mcp-gitlab get secret mcp-gitlab-tls`

## Bezpečnostní Checklist

- [ ] **OAuth Credentials** v Kubernetes Secretu (ne v kódu)
- [ ] **TLS/HTTPS** aktivní (cert-manager)
- [ ] **ALLOWED_ORIGINS** nakonfigurován
- [ ] **Rate limiting** aktivní
- [ ] **Pod security context** (non-root user)
- [ ] **Resource limits** nastaveny
- [ ] **Network policies** (pokud používáte)
- [ ] **GitLab OAuth scopes** minimalizovány (jen potřebné)
- [ ] **Logging** do centrálního systému
- [ ] **Metrics** exportovány do Prometheus

## Production Tips

### High Availability

- **Replicas: 2+** pro redundanci
- **Pod Disruption Budget**:
  ```yaml
  apiVersion: policy/v1
  kind: PodDisruptionBudget
  metadata:
    name: mcp-gitlab-pdb
    namespace: mcp-gitlab
  spec:
    minAvailable: 1
    selector:
      matchLabels:
        app: mcp-gitlab
  ```

### Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mcp-gitlab
  namespace: mcp-gitlab
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mcp-gitlab
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Persistent Sessions

Pro persistentní OAuth tokeny mezi restartami:

```yaml
# statefulset.yaml místo deployment.yaml
# + PersistentVolumeClaim pro token storage
```

⚠️ **Poznámka**: Aktuální implementace ukládá tokeny in-memory. Pro production doporučuji rozšířit na Redis/DB.

## Next Steps

1. **Deploy monitoring** (Prometheus + Grafana)
2. **Nastavit alerty** (OAuth failures, rate limits)
3. **Backup strategie** pro OAuth secrets
4. **Dokumentace pro uživatele** - jak se připojit
5. **Runbook pro operations** - restart, scale, debug

## Reference

- [MCP OAuth Documentation](./OAUTH.md)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)
- [GitLab OAuth Documentation](https://docs.gitlab.com/ee/api/oauth2.html)


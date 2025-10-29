#!/bin/bash

# Script to create Kubernetes secret with MCP GitLab profiles
# Usage: ./create-k8s-mcp-secret.sh [namespace]

set -e

NAMESPACE=${1:-ai-adoption}

echo "Creating MCP GitLab profiles secret in namespace: $NAMESPACE"

FILE_UPDATED=false

# Create temporary secret manifest
TEMP_FILE=$(mktemp)

cat > "$TEMP_FILE" << EOF
apiVersion: v1
kind: Secret
metadata:
  name: mcp-profiles
  namespace: $NAMESPACE
  labels:
    app: mcp-gitlab
type: Opaque
data:
EOF

for profile in $(ls -1 profiles/); do
  for file in $(ls -1 profiles/"$profile"); do
    FILE_UPDATED=true
    echo " ${profile}-${file}: $(base64 -w 0 profiles/${profile}/${file})">>$TEMP_FILE
  done
done

if [ "$FILE_UPDATED" = false ]; then
  echo "No files to update"
  exit 0
fi

echo "Generated secret manifest:"
cat "$TEMP_FILE"

# Apply to Kubernetes
echo "Applying secret to Kubernetes..."
kubectl apply -f "$TEMP_FILE"

# Clean up
rm "$TEMP_FILE"

echo "Secret created/updated successfully!"
echo "You can verify with: kubectl get secret mcp-profiles -n $NAMESPACE"

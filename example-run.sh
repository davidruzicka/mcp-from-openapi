#!/bin/bash

# Example: How to run the MCP server with an API
# See EXAMPLE-GITLAB.md for GitLab-specific configuration

# Set required environment variables
export OPENAPI_SPEC_PATH="./openapi.yaml"
export MCP_PROFILE_PATH="./profiles/api-profile.json"
export MCP_TRANSPORT="stdio"

# API configuration (replace with your values)
export API_TOKEN="your_api_token_here"
export API_BASE_URL="https://api.example.com"

# Optional: Enable debug logging
# export DEBUG=true

echo "Starting MCP server..."
echo "OpenAPI spec: $OPENAPI_SPEC_PATH"
echo "Profile: $MCP_PROFILE_PATH"
echo "Transport: $MCP_TRANSPORT"
echo ""

# Build if not already built
if [ ! -d "dist" ]; then
  echo "Building TypeScript..."
  npm run build
fi

# Run the server
npm start


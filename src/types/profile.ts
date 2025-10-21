/**
 * Profile configuration types
 * 
 * Why these types: Profiles define which MCP tools are exposed and how they map
 * to OpenAPI operations. This enables same server to serve different use cases
 * (admin vs developer vs readonly) without code changes.
 */

export interface Profile {
  profile_name: string;
  description?: string;
  tools: ToolDefinition[];
  interceptors?: InterceptorConfig;
  parameter_aliases?: Record<string, string[]>; // e.g., {"id": ["resource_id", "project_id"]}
}

export interface ToolDefinition {
  name: string;
  description: string;
  
  // Simple tools: direct mapping to single or multiple operations
  operations?: Record<string, string> | { [key: string]: string };
  
  // Composite tools: chain multiple API calls
  composite?: boolean;
  steps?: CompositeStep[];
  partial_results?: boolean; // Return partial results on error (default: false)
  
  parameters: Record<string, ParameterDefinition>;
  
  // Parameters that are metadata (don't go to API body)
  metadata_params?: string[]; // default: ['action', 'resource_type']
  
  // Response field filtering (reduces verbosity for list operations)
  response_fields?: Record<string, string[]>; // e.g., {"list": ["id", "name", "path"]}
}

export interface ParameterDefinition {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  required_for?: string[]; // Which actions require this parameter
  enum?: string[];
  items?: { type: string };
  default?: unknown;
  example?: unknown;
}

export interface CompositeStep {
  call: string; // e.g., "GET /projects/{id}/merge_requests/{iid}"
  store_as: string; // JSONPath-like: "merge_request", "merge_request.comments"
  depends_on?: string[]; // Optional dependencies on other steps' store_as values
}

export interface InterceptorConfig {
  auth?: AuthInterceptor;
  base_url?: BaseUrlConfig;
  rate_limit?: RateLimitConfig;
  retry?: RetryConfig;
  array_format?: 'brackets' | 'indices' | 'repeat' | 'comma'; // default: 'repeat'
}

/**
 * Auth interceptor configuration
 * 
 * - bearer: Standard HTTP Bearer token (Authorization: Bearer <token>)
 * - query: API key in query string (?api_key=<token>)
 * - custom-header: Custom header name (e.g., X-API-Key: <token>)
 */
export interface AuthInterceptor {
  type: 'bearer' | 'query' | 'custom-header';
  header_name?: string;  // Required for custom-header
  query_param?: string;  // Required for query
  value_from_env: string;
}

export interface BaseUrlConfig {
  value_from_env: string;
  default?: string;
}

export interface RateLimitConfig {
  max_requests_per_minute: number;
  overrides?: Record<string, { max_requests_per_minute: number }>;
}

export interface RetryConfig {
  max_attempts: number;
  backoff_ms: number[]; // e.g., [1000, 2000, 4000]
  retry_on_status: number[];
}


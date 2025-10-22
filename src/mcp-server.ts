/**
 * Main MCP server implementation
 * 
 * Why: Coordinates OpenAPI parser, profile loader, tool generator, and request execution.
 * Single entry point for tool registration and invocation.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { OpenAPIParser } from './openapi-parser.js';
import { ProfileLoader } from './profile-loader.js';
import { ToolGenerator } from './tool-generator.js';
import { CompositeExecutor } from './composite-executor.js';
import { ConfigurationError, OperationNotFoundError, ValidationError, AuthenticationError } from './errors.js';
import { InterceptorChain, HttpClient } from './interceptors.js';
import { SchemaValidator } from './schema-validator.js';
import type { Profile, ToolDefinition, AuthInterceptor } from './types/profile.js';
import type { Logger } from './logger.js';
import { ConsoleLogger, JsonLogger } from './logger.js';
import type { OperationInfo } from './types/openapi.js';

export class MCPServer {
  private server: Server;
  private parser: OpenAPIParser;
  private profile?: Profile;
  private toolGenerator: ToolGenerator;
  private httpClient?: HttpClient;
  private compositeExecutor?: CompositeExecutor;
  private schemaValidator: SchemaValidator;
  private logger: Logger;
  private httpTransport: any = null;
  private sessionHttpClients: Map<string, HttpClient> = new Map();

  /**
   * Filter response object to include only specified fields
   * Supports nested objects but keeps first level of arrays
   */
  private filterFields(data: unknown, fields: string[]): unknown {
    if (!data || typeof data !== 'object') {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.filterFields(item, fields));
    }

    const filtered: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in data) {
        filtered[field] = (data as Record<string, unknown>)[field];
      }
    }
    return filtered;
  }

  constructor(logger?: Logger) {
    this.logger = logger || new ConsoleLogger();
    this.schemaValidator = new SchemaValidator();
    this.server = new Server(
      {
        name: 'mcp-from-openapi',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.parser = new OpenAPIParser();
    this.toolGenerator = new ToolGenerator(this.parser);
    
    this.setupHandlers();
  }

  async initialize(specPath: string, profilePath?: string): Promise<void> {
    // Load OpenAPI spec
    await this.parser.load(specPath);
    this.logger.info('Loaded OpenAPI spec', { specPath });

    // Load profile
    if (profilePath) {
      const loader = new ProfileLoader();
      this.profile = await loader.load(profilePath);
      this.logger.info('Loaded profile', {
        profile: this.profile.profile_name,
        toolCount: this.profile.tools.length,
      });
    } else {
      this.profile = ProfileLoader.createDefaultProfile('default');
      this.logger.warn('Using default profile (no profile specified)');
    }

    // Re-create logger with auth config for token redaction
    if (this.profile.interceptors?.auth) {
      this.logger = this.createLoggerWithAuth(this.profile.interceptors.auth);
      this.logger.info('Logger re-configured with auth token redaction');
    }

    // Setup HTTP client with interceptors
    // For stdio transport, create client with env token
    // For HTTP transport, clients are created per-session with user's token
    const baseUrl = this.getBaseUrl();
    if (this.profile.interceptors?.auth) {
      const envToken = process.env[this.profile.interceptors.auth.value_from_env];
      if (envToken) {
        // Token available in env - create global client (stdio transport)
        const interceptors = new InterceptorChain(this.profile.interceptors);
        this.httpClient = new HttpClient(baseUrl, interceptors);
        this.compositeExecutor = new CompositeExecutor(this.parser, this.httpClient);
      } else {
        // No env token - will use per-session clients (HTTP transport)
        this.compositeExecutor = new CompositeExecutor(this.parser);
      }
    } else {
      // No auth configured
      const interceptors = new InterceptorChain(this.profile.interceptors || {});
      this.httpClient = new HttpClient(baseUrl, interceptors);
      this.compositeExecutor = new CompositeExecutor(this.parser, this.httpClient);
    }
    
    this.logger.info('MCP server initialized', {
      baseUrl,
      toolCount: this.profile.tools.length,
    });
  }

  /**
   * Create logger with auth configuration for token redaction
   * 
   * Why: Prevents sensitive tokens from appearing in logs
   */
  private createLoggerWithAuth(authConfig: AuthInterceptor): Logger {
    const logFormat = process.env.LOG_FORMAT || 'console';
    const logLevel = this.logger instanceof ConsoleLogger || this.logger instanceof JsonLogger
      ? (this.logger as any).level
      : undefined;
    
    return logFormat === 'json'
      ? new JsonLogger(logLevel, authConfig)
      : new ConsoleLogger(logLevel, authConfig);
  }

  /**
   * Get base URL from profile config or OpenAPI spec
   */
  private getBaseUrl(): string {
    const baseUrlConfig = this.profile?.interceptors?.base_url;
    
    if (baseUrlConfig) {
      const envValue = process.env[baseUrlConfig.value_from_env];
      if (envValue) return envValue;
      if (baseUrlConfig.default) return baseUrlConfig.default;
    }

    return this.parser.getBaseUrl();
  }

  /**
   * Get or create HTTP client for session
   */
  private getHttpClientForSession(sessionId?: string): HttpClient {
    if (!sessionId) {
      // Fallback to global client for stdio transport
      if (!this.httpClient) {
        const hasHttpTransport = !!this.httpTransport;
        const transport = hasHttpTransport ? 'http' : 'stdio';
        const authConfig = this.profile?.interceptors?.auth;
        const envVarName = authConfig?.value_from_env || 'API_TOKEN';
        const hasEnvToken = !!process.env[envVarName];
        
        throw new ConfigurationError(
          `HTTP client not initialized. ` +
          `Transport: ${transport}, ` +
          `HasEnvToken(${envVarName}): ${hasEnvToken}, ` +
          `Suggestion: ${hasHttpTransport
            ? 'Send token in Authorization header during initialization'
            : `Set ${envVarName} environment variable`}`,
          { transport, hasEnvToken, envVarName, hasHttpTransport }
        );
      }
      return this.httpClient;
    }

    // Check cache first
    let client = this.sessionHttpClients.get(sessionId);
    if (client) {
      return client;
    }

    // Get auth token from session or env
    const authToken = this.getAuthTokenFromSession(sessionId);
    const envToken = this.profile?.interceptors?.auth 
      ? process.env[this.profile.interceptors.auth.value_from_env]
      : undefined;
    
    if (!authToken && !envToken) {
      const authConfig = this.profile?.interceptors?.auth;
      const expectedEnvVar = authConfig?.value_from_env || 'API_TOKEN';
      throw new AuthenticationError(
        `No auth token found for session ${sessionId}. ` +
        `Expected token in Authorization/X-API-Token header or ${expectedEnvVar} env var`,
        { sessionId, expectedEnvVar, hasProfile: !!this.profile }
      );
    }

    // Create new client with session-specific interceptor
    if (!this.profile) {
      throw new ConfigurationError('Profile not initialized. Call initialize() first.');
    }
    
    const baseUrl = this.getBaseUrl();
    const tokenToUse = authToken || envToken;
    const interceptors = new InterceptorChain(this.profile.interceptors || {}, tokenToUse);
    const newClient = new HttpClient(baseUrl, interceptors);

    // Double-check: Another concurrent request might have created client
    // Race condition prevention: Use first client that was set
    const existingClient = this.sessionHttpClients.get(sessionId);
    if (existingClient) {
      // Another request won the race, use its client
      return existingClient;
    }

    // We won the race, cache our client
    this.sessionHttpClients.set(sessionId, newClient);
    return newClient;
  }

  /**
   * Get auth token from HTTP transport session
   */
  private getAuthTokenFromSession(sessionId: string): string | undefined {
    if (!this.httpTransport) {
      return undefined;
    }

    // Use public API instead of type casting
    return this.httpTransport.getSessionToken(sessionId);
  }

  /**
   * Cleanup HTTP client for destroyed session
   * 
   * Why: Prevent memory leak - sessions expire but cached clients stay forever
   */
  private cleanupSessionClient(sessionId: string): void {
    const removed = this.sessionHttpClients.delete(sessionId);
    if (removed) {
      this.logger.info('Cleaned up session HTTP client', { sessionId });
    }
  }

  /**
   * Setup MCP request handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!this.profile) {
        throw new ConfigurationError('Server not initialized. Call initialize() first.');
      }

      const tools = this.profile.tools.map(toolDef =>
        this.toolGenerator.generateTool(toolDef)
      );

      return { tools };
    });

    // Execute tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!this.profile || !this.httpClient || !this.compositeExecutor) {
        throw new ConfigurationError('Server not initialized. Call initialize() first.');
      }

      const toolDef = this.profile.tools.find(t => t.name === request.params.name);
      if (!toolDef) {
        throw new OperationNotFoundError(request.params.name);
      }

      const args = request.params.arguments || {};
      
      // Validate arguments
      this.toolGenerator.validateArguments(toolDef, args);

      // Execute composite or simple tool
      let result: unknown;
      
      if (toolDef.composite && toolDef.steps) {
        const compositeResult = await this.compositeExecutor.execute(
          toolDef.steps,
          args,
          toolDef.partial_results || false
        );
        
        // Include metadata about completion
        result = {
          ...compositeResult.data,
          _metadata: {
            completed_steps: compositeResult.completed_steps,
            total_steps: compositeResult.total_steps,
            success: compositeResult.completed_steps === compositeResult.total_steps,
            errors: compositeResult.errors,
          },
        };
      } else {
        result = await this.executeSimpleTool(toolDef, args);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    });
  }

  /**
   * Execute simple (non-composite) tool
   *
   * Why separate: Simple tools map directly to single OpenAPI operation.
   * No result aggregation needed.
   */
  private async executeSimpleTool(
    toolDef: ToolDefinition,
    args: Record<string, unknown>,
    sessionId?: string
  ): Promise<unknown> {
    const operationId = this.toolGenerator.mapActionToOperation(toolDef, args);
    
    if (!operationId) {
      throw new ValidationError(
        `Could not map tool action to operation`,
        {
          toolName: toolDef.name,
          action: args['action'],
          resourceType: args['resource_type'],
          availableOperations: Object.keys(toolDef.operations || {})
        }
      );
    }

    const operation = this.parser.getOperation(operationId);
    if (!operation) {
      throw new OperationNotFoundError(operationId);
    }

    // Build request
    const path = this.resolvePath(operation.path, args);
    const queryParams = this.extractQueryParams(operation, args);
    const body = this.extractBody(operation, args, toolDef);

    // Validate request body against schema
    if (body && operation.requestBody) {
      const validationResult = this.schemaValidator.validateRequestBody(operation, body);
      
      if (!validationResult.valid && validationResult.errors) {
        const errorDetails = validationResult.errors
          .map(e => `  - ${e.path}: ${e.message}`)
          .join('\n');
        throw new ValidationError(
          `Request body validation failed:\n${errorDetails}`,
          { operationId, validationErrors: validationResult.errors }
        );
      }
    }

    // Execute with session-specific client
    const httpClient = this.getHttpClientForSession(sessionId);
    const response = await httpClient.request(operation.method, path, {
      params: queryParams,
      body,
      operationId: operationId,
    });

    // Apply response field filtering if configured
    let result = response.body;
    if (toolDef.response_fields) {
      const action = args.action as string | undefined;
      if (action && toolDef.response_fields[action]) {
        const fields = toolDef.response_fields[action];
        result = this.filterFields(result, fields);
      }
    }

    return result;
  }

  /**
   * Resolve path parameters using profile aliases
   * 
   * Why aliases: Different tools may use different parameter names for same path param.
   * Example: GitLab uses "resource_id", "project_id", "group_id" all mapping to "{id}"
   */
  private resolvePath(template: string, args: Record<string, unknown>): string {
    const aliases = this.profile?.parameter_aliases || {};
    
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      // Try direct match first
      if (args[key] !== undefined) {
        return String(args[key]);
      }

      // Try aliases from profile
      const possibleAliases = aliases[key] || [];
      for (const alias of possibleAliases) {
        if (args[alias] !== undefined) {
          return String(args[alias]);
        }
      }

      throw new ValidationError(
        `Missing path parameter: ${key}` +
        (possibleAliases.length > 0 ? `. Tried aliases: ${possibleAliases.join(', ')}` : ''),
        { paramName: key, possibleAliases }
      );
    });
  }

  /**
   * Extract query parameters from args
   * 
   * Why: Separate query params from body params. Array handling is done by HttpClient
   * based on profile's array_format setting.
   */
  private extractQueryParams(
    operation: OperationInfo,
    args: Record<string, unknown>
  ): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};

    for (const param of operation.parameters) {
      if (param.in === 'query' && args[param.name] !== undefined) {
        const value = args[param.name];
        
        // Pass arrays as-is, HttpClient will serialize based on array_format
        if (Array.isArray(value)) {
          params[param.name] = value.map(String);
        } else {
          params[param.name] = String(value);
        }
      }
    }

    return params;
  }

  /**
   * Extract request body from args
   * 
   * Why: For create/update operations, collect non-metadata fields into body.
   * Metadata (action, resource_type, etc.) are not sent to API.
   * Path/query parameters are also excluded from body.
   * 
   * Uses metadata_params from tool definition, defaults to ['action', 'resource_type']
   */
  private extractBody(
    operation: OperationInfo,
    args: Record<string, unknown>,
    toolDef: ToolDefinition
  ): Record<string, unknown> | undefined {
    // Metadata fields from tool definition (or defaults)
    const metadataList = toolDef.metadata_params || ['action', 'resource_type'];
    const metadata = new Set(metadataList);
    
    // Collect parameter names that go in path or query
    const pathOrQuery = new Set<string>();
    for (const param of operation.parameters) {
      if (param.in === 'path' || param.in === 'query') {
        pathOrQuery.add(param.name);
      }
    }
    
    const body: Record<string, unknown> = {};
    let hasBody = false;

    for (const [key, value] of Object.entries(args)) {
      if (!metadata.has(key) && !pathOrQuery.has(key) && value !== undefined) {
        body[key] = value;
        hasBody = true;
      }
    }

    return hasBody ? body : undefined;
  }

  /**
   * Start server with stdio transport
   */
  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.logger.info('MCP server running on stdio');
  }

  /**
   * Start server with HTTP transport
   * 
   * Implements MCP Specification 2025-03-26 Streamable HTTP transport
   * 
   * Why: Enables remote MCP server access with SSE streaming, session management,
   * and resumability for reliable communication over HTTP.
   */
  async runHttp(host: string, port: number): Promise<void> {
    const { HttpTransport } = await import('./http-transport.js');
    
    const config = {
      host,
      port,
      sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '1800000', 10),
      heartbeatEnabled: process.env.HEARTBEAT_ENABLED === 'true',
      heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
      metricsEnabled: process.env.METRICS_ENABLED === 'true',
      metricsPath: process.env.METRICS_PATH || '/metrics',
      allowedOrigins: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
        : undefined,
    };

    this.httpTransport = new HttpTransport(config, this.logger);
    
    // Set message handler to process JSON-RPC messages
    this.httpTransport.setMessageHandler(async (message: unknown, sessionId?: string) => {
      return await this.handleJsonRpcMessage(message, sessionId);
    });

    // Register cleanup listener for session destruction (memory leak prevention)
    this.httpTransport.onSessionDestroyed((sessionId: string) => {
      this.cleanupSessionClient(sessionId);
    });

    await this.httpTransport.start();
    
    this.logger.info('MCP server running on HTTP', { host, port });
  }

  /**
   * Handle JSON-RPC message from HTTP transport
   *
   * Why: Unified message handling for both stdio and HTTP transports
   */
  private async handleJsonRpcMessage(message: unknown, sessionId?: string): Promise<unknown> {
    // Handle initialize
    if (this.isInitializeRequest(message)) {
      return this.handleInitialize(message, sessionId);
    }

    // Handle tool calls
    if (this.isToolCallRequest(message)) {
      return await this.handleToolCall(message, sessionId);
    }

    // Handle other JSON-RPC requests
    // (tools/list, prompts/list, etc.)
    return this.handleOtherRequest(message);
  }

  private isInitializeRequest(message: unknown): boolean {
    if (typeof message !== 'object' || message === null) return false;
    const req = message as Record<string, unknown>;
    return req.method === 'initialize';
  }

  private isToolCallRequest(message: unknown): boolean {
    if (typeof message !== 'object' || message === null) return false;
    const req = message as Record<string, unknown>;
    return req.method === 'tools/call';
  }

  private handleInitialize(message: unknown, sessionId?: string): unknown {
    const req = message as Record<string, unknown>;

    const result: any = {
      protocolVersion: '2025-03-26',
      serverInfo: {
        name: 'mcp-from-openapi',
        version: '0.1.0',
      },
      capabilities: {
        tools: {},
      },
    };

    // Include sessionId if available (for HTTP transport)
    if (sessionId) {
      result.sessionId = sessionId;
    }

    return {
      jsonrpc: '2.0',
      id: req.id,
      result,
    };
  }

  private async handleToolCall(message: unknown, sessionId?: string): Promise<unknown> {
    const req = message as Record<string, unknown>;
    const params = req.params as Record<string, unknown>;
    const toolName = params.name as string;
    const args = params.arguments as Record<string, unknown>;

    try {
      // Find tool definition
      const toolDef = this.profile?.tools.find(t => t.name === toolName);
      if (!toolDef) {
        throw new OperationNotFoundError(toolName);
      }

      // Execute tool (reuse existing execution logic)
      let result;
      if (toolDef.composite && toolDef.steps) {
        const httpClient = this.getHttpClientForSession(sessionId);
        const compositeResult = await this.compositeExecutor!.execute(
          toolDef.steps,
          args,
          toolDef.partial_results || false,
          httpClient
        );
        result = {
          data: compositeResult.data,
          completed_steps: compositeResult.completed_steps,
          total_steps: compositeResult.total_steps,
          success: compositeResult.completed_steps === compositeResult.total_steps,
          errors: compositeResult.errors,
        };
      } else {
        result = await this.executeSimpleTool(toolDef, args, sessionId);
      }

      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: -32603,
          message: (error as Error).message,
        },
      };
    }
  }

  private handleOtherRequest(message: unknown): unknown {
    const req = message as Record<string, unknown>;
    
    // Handle tools/list
    if (req.method === 'tools/list') {
      const tools = this.profile?.tools.map(toolDef =>
        this.toolGenerator!.generateTool(toolDef)
      ) || [];
      
      return {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          tools,
        },
      };
    }

    // Unknown method
    return {
      jsonrpc: '2.0',
      id: req.id,
      error: {
        code: -32601,
        message: `Method not found: ${req.method}`,
      },
    };
  }

  /**
   * Stop the MCP server gracefully
   *
   * Why: Cleanup resources, close connections, allow graceful shutdown
   */
  async stop(): Promise<void> {
    if (this.httpTransport) {
      await this.httpTransport.stop();
    }
  }
}


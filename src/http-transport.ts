/**
 * HTTP Streamable Transport for MCP
 * 
 * Implements MCP Specification 2025-03-26
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 * 
 * Why: Enables remote MCP server access with SSE streaming, session management,
 * and resumability for reliable communication over HTTP.
 */

import express, { Request, Response, NextFunction } from 'express';
import type { Server } from 'http';
import crypto from 'crypto';
import type { Logger } from './logger.js';
import type {
  SessionData,
  SSEStreamState,
  QueuedMessage,
  HttpTransportConfig,
  McpRequest
} from './types/http-transport.js';
import { MetricsCollector } from './metrics.js';

export class HttpTransport {
  private app: express.Application;
  private server: Server | null = null;
  private sessions: Map<string, SessionData> = new Map();
  private config: HttpTransportConfig;
  private logger: Logger;
  private metrics: MetricsCollector | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private messageHandler: ((message: unknown, sessionId?: string) => Promise<unknown>) | null = null;

  constructor(config: HttpTransportConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    
    // Initialize metrics if enabled
    if (config.metricsEnabled) {
      this.metrics = new MetricsCollector({
        enabled: true,
        prefix: 'mcp_',
      });
    }
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   * 
   * Why: Security (Origin validation), JSON parsing, session extraction, metrics
   */
  private setupMiddleware(): void {
    // JSON body parser
    this.app.use(express.json());

    // Metrics: Track request start time
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      (req as any).startTime = Date.now();
      next();
    });

    // Security: Origin validation (DNS rebinding protection)
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      
      // Warn if binding to 0.0.0.0
      if (this.config.host === '0.0.0.0' && !this.hasWarnedAboutBinding) {
        this.logger.warn('HTTP transport bound to 0.0.0.0 - accessible from network. Ensure firewall protection.');
        this.hasWarnedAboutBinding = true;
      }

      // Skip Origin check for localhost
      if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') {
        return next();
      }

      // Validate Origin header for non-localhost
      if (origin && !this.isAllowedOrigin(origin)) {
        this.logger.warn('Rejected request from disallowed origin', { origin, ip: req.ip });
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Origin not allowed'
        });
      }

      next();
    });

    // Extract session ID from header
    this.app.use((req: McpRequest, res: Response, next: NextFunction) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId) {
        req.sessionId = sessionId;
      }
      next();
    });
  }

  private hasWarnedAboutBinding = false;

  /**
   * Check if origin is allowed
   * 
   * Why: Prevent DNS rebinding attacks
   * 
   * Supports:
   * - Exact hostname: 'example.com', 'api.example.com'
   * - Wildcard subdomain: '*.example.com'
   * - IPv4 CIDR: '192.168.1.0/24', '10.0.0.0/8'
   * - IPv4 exact: '192.168.1.100'
   */
  private isAllowedOrigin(origin: string): boolean {
    try {
      const url = new URL(origin);
      const hostname = url.hostname;

      // Always allow localhost
      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return true;
      }

      // Allow configured host
      if (hostname === this.config.host) {
        return true;
      }

      // Check custom allowed origins
      if (this.config.allowedOrigins && this.config.allowedOrigins.length > 0) {
        for (const allowed of this.config.allowedOrigins) {
          if (this.matchOrigin(hostname, allowed)) {
            return true;
          }
        }
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Match hostname against allowed origin pattern
   * 
   * Supports:
   * - Exact match: 'example.com' === 'example.com'
   * - Wildcard: '*.example.com' matches 'api.example.com', 'web.example.com'
   * - CIDR: '192.168.1.0/24' matches '192.168.1.1' through '192.168.1.254'
   */
  private matchOrigin(hostname: string, pattern: string): boolean {
    // Exact match
    if (hostname === pattern) {
      return true;
    }

    // Wildcard subdomain match (*.example.com)
    if (pattern.startsWith('*.')) {
      const domain = pattern.substring(2); // Remove '*.'
      return hostname.endsWith('.' + domain) || hostname === domain;
    }

    // CIDR match (IPv4 only)
    if (pattern.includes('/')) {
      return this.matchCIDR(hostname, pattern);
    }

    return false;
  }

  /**
   * Check if IP address is within CIDR range
   * 
   * Example: '192.168.1.50' matches '192.168.1.0/24'
   */
  private matchCIDR(ip: string, cidr: string): boolean {
    // Parse CIDR
    const [range, bits] = cidr.split('/');
    const maskBits = parseInt(bits, 10);

    if (isNaN(maskBits) || maskBits < 0 || maskBits > 32) {
      this.logger.warn('Invalid CIDR mask bits', { cidr });
      return false;
    }

    // Convert IP addresses to 32-bit integers
    const ipInt = this.ipToInt(ip);
    const rangeInt = this.ipToInt(range);

    if (ipInt === null || rangeInt === null) {
      return false;
    }

    // Create mask (e.g., /24 = 0xFFFFFF00)
    const mask = (0xFFFFFFFF << (32 - maskBits)) >>> 0;

    // Compare network portions
    return (ipInt & mask) === (rangeInt & mask);
  }

  /**
   * Convert IPv4 address to 32-bit integer
   * 
   * Example: '192.168.1.1' -> 3232235777
   */
  private ipToInt(ip: string): number | null {
    const parts = ip.split('.');
    
    if (parts.length !== 4) {
      return null;
    }

    let result = 0;
    for (let i = 0; i < 4; i++) {
      const octet = parseInt(parts[i], 10);
      if (isNaN(octet) || octet < 0 || octet > 255) {
        return null;
      }
      result = (result << 8) | octet;
    }

    return result >>> 0; // Unsigned
  }

  /**
   * Setup MCP endpoint routes
   * 
   * Why: Single endpoint for POST (client→server) and GET (SSE stream)
   */
  private setupRoutes(): void {
    // Main MCP endpoint - POST for sending messages
    this.app.post('/mcp', this.handlePost.bind(this));

    // Main MCP endpoint - GET for SSE streaming
    this.app.get('/mcp', this.handleGet.bind(this));

    // Session termination
    this.app.delete('/mcp', this.handleDelete.bind(this));

    // Metrics endpoint (if enabled)
    if (this.config.metricsEnabled) {
      this.app.get(this.config.metricsPath, this.handleMetrics.bind(this));
    }

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      const startTime = Date.now();
      res.json({ status: 'ok', sessions: this.sessions.size });
      
      if (this.metrics) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, res.statusCode, duration);
      }
    });
  }
  
  /**
   * Handle metrics endpoint
   * 
   * Why: Prometheus scraping endpoint
   */
  private async handleMetrics(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      if (!this.metrics) {
        res.status(404).json({ error: 'Not Found', message: 'Metrics disabled' });
        return;
      }
      
      const metrics = await this.metrics.getMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
      
      // Don't record metrics call in metrics (avoid recursion)
    } catch (error) {
      this.logger.error('Metrics endpoint error', error as Error);
      res.status(500).json({ error: 'Internal Server Error', message: (error as Error).message });
    }
  }

  /**
   * Validate token format and length
   * 
   * Why centralized: Single source of truth for token validation rules
   */
  private validateToken(token: string, source: string): void {
    if (token.length > 1000) {
      throw new Error(`${source} too long (max 1000 characters)`);
    }
    // RFC 6750 Bearer token characters + common API token chars
    if (!/^[A-Za-z0-9\-._~+/]+=*$/.test(token)) {
      throw new Error(`Invalid ${source} format`);
    }
  }

  /**
   * Extract and validate auth token from request headers
   * 
   * Supports:
   * - Authorization: Bearer <token>
   * - X-API-Token: <token>
   * 
   * Why strict validation: Prevents header injection attacks
   */
  private extractAuthToken(req: McpRequest): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      // Strict Bearer token format validation
      const match = authHeader.match(/^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/);
      if (!match) {
        throw new Error('Invalid Authorization header format. Expected: Bearer <token>');
      }
      const token = match[1];
      this.validateToken(token, 'Authorization token');
      return token;
    }
    
    const apiTokenHeader = req.headers['x-api-token'];
    if (apiTokenHeader) {
      if (typeof apiTokenHeader !== 'string') {
        throw new Error('X-API-Token must be a string');
      }
      this.validateToken(apiTokenHeader, 'X-API-Token');
      return apiTokenHeader;
    }
    
    return undefined;
  }

  /**
   * Handle POST requests - Client sending messages to server
   * 
   * MCP Spec: POST can contain requests, notifications, or responses
   */
  private async handlePost(req: McpRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      const sessionId = req.sessionId;
      const body = req.body;

      // Validate Accept header
      const accept = req.headers.accept || '';
      if (!accept.includes('application/json') && !accept.includes('text/event-stream')) {
        res.status(406).json({ error: 'Not Acceptable', message: 'Must accept application/json or text/event-stream' });
        return;
      }

      // Check if this is initialization (no session ID yet)
      const isInitialization = this.isInitializeRequest(body);

      // Validate session (except for initialization)
      if (!isInitialization && sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
          res.status(404).json({ error: 'Not Found', message: 'Session not found or expired' });
          return;
        }
        this.updateSessionActivity(sessionId);
      } else if (!isInitialization && !sessionId) {
        res.status(400).json({ error: 'Bad Request', message: 'Mcp-Session-Id header required (except for initialization)' });
        return;
      }

      // Determine message type
      const messageType = this.getMessageType(body);

      // If only notifications/responses, return 202 Accepted
      if (messageType === 'notification-only' || messageType === 'response-only') {
        if (this.messageHandler) {
          await this.messageHandler(body);
        }
        res.status(202).send();
        return;
      }

      // If contains requests, process and return response
      if (messageType === 'request') {
        if (!this.messageHandler) {
          res.status(500).json({ error: 'Internal Server Error', message: 'Message handler not configured' });
          return;
        }

        const response = await this.messageHandler(body, sessionId);

        // Create session on initialization
        let newSessionId: string | undefined;
        if (isInitialization) {
          // Extract and validate auth token from headers
          const authToken = this.extractAuthToken(req);
          newSessionId = this.createSession(authToken);
        }

        // Check if client prefers SSE stream
        if (accept.includes('text/event-stream')) {
          // Return SSE stream
          this.startSSEResponse(res, response, newSessionId, sessionId);
        } else {
          // Return JSON
          if (newSessionId) {
            res.setHeader('Mcp-Session-Id', newSessionId);
          }
          res.json(response);
        }
        return;
      }

      res.status(400).json({ error: 'Bad Request', message: 'Invalid message type' });
    } catch (error) {
      this.logger.error('POST request error', error as Error);
      const status = 500;
      res.status(status).json({ error: 'Internal Server Error', message: (error as Error).message });
      
      // Record error metrics
      if (this.metrics) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, status, duration);
      }
    } finally {
      // Record success metrics (if not already recorded in catch)
      if (this.metrics && res.statusCode !== 500) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, res.statusCode, duration);
      }
    }
  }

  /**
   * Handle GET requests - Client opening SSE stream for server messages
   * 
   * MCP Spec: GET opens SSE stream for server-initiated requests/notifications
   */
  private async handleGet(req: McpRequest, res: Response): Promise<void> {
    const startTime = Date.now();
    try {
      const sessionId = req.sessionId;
      const lastEventId = req.headers['last-event-id'] as string | undefined;

      // Validate Accept header
      const accept = req.headers.accept || '';
      if (!accept.includes('text/event-stream')) {
        res.status(405).json({ error: 'Method Not Allowed', message: 'Must accept text/event-stream' });
        return;
      }

      // Validate session
      if (!sessionId) {
        res.status(400).json({ error: 'Bad Request', message: 'Mcp-Session-Id header required' });
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Not Found', message: 'Session not found or expired' });
        return;
      }

      this.updateSessionActivity(sessionId);

      // Start SSE stream
      this.startSSEStream(res, sessionId, lastEventId);
      
      // Record metrics for successful SSE start
      if (this.metrics) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, 200, duration);
      }
    } catch (error) {
      this.logger.error('GET request error', error as Error);
      const status = 500;
      if (!res.headersSent) {
        res.status(status).json({ error: 'Internal Server Error', message: (error as Error).message });
      }
      
      // Record error metrics
      if (this.metrics) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, status, duration);
      }
    }
  }

  /**
   * Handle DELETE requests - Client terminating session
   * 
   * MCP Spec: DELETE explicitly terminates session
   */
  private handleDelete(req: McpRequest, res: Response): void {
    const startTime = Date.now();
    const sessionId = req.sessionId;

    if (!sessionId) {
      const status = 400;
      res.status(status).json({ error: 'Bad Request', message: 'Mcp-Session-Id header required' });
      if (this.metrics) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, status, duration);
      }
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      const status = 404;
      res.status(status).json({ error: 'Not Found', message: 'Session not found' });
      if (this.metrics) {
        const duration = (Date.now() - startTime) / 1000;
        this.metrics.recordHttpRequest(req.method, req.path, status, duration);
      }
      return;
    }

    this.destroySession(sessionId);
    const status = 204;
    res.status(status).send();
    
    if (this.metrics) {
      const duration = (Date.now() - startTime) / 1000;
      this.metrics.recordHttpRequest(req.method, req.path, status, duration);
    }
  }

  /**
   * Start SSE response for a POST request
   * 
   * Why: Returns response via SSE stream, allows server-initiated messages
   */
  private startSSEResponse(
    res: Response,
    response: unknown,
    newSessionId: string | undefined,
    sessionId: string | undefined
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (newSessionId) {
      res.setHeader('Mcp-Session-Id', newSessionId);
    }

    // Send response
    const eventId = Date.now();
    res.write(`id: ${eventId}\n`);
    res.write(`data: ${JSON.stringify(response)}\n\n`);

    // Close stream
    res.end();
  }

  /**
   * Start SSE stream for GET request
   * 
   * Why: Allows server to send requests/notifications to client
   */
  private startSSEStream(res: Response, sessionId: string, lastEventId?: string): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const streamId = crypto.randomBytes(16).toString('hex');
    const session = this.sessions.get(sessionId)!;

    const streamState: SSEStreamState = {
      streamId,
      lastEventId: lastEventId ? parseInt(lastEventId, 10) : 0,
      messageQueue: [],
      active: true,
    };

    session.sseStreams.set(streamId, streamState);

    // Replay missed messages if resuming
    if (lastEventId) {
      this.replayMessages(res, streamState);
    }

    // Setup heartbeat if enabled
    let heartbeatInterval: NodeJS.Timeout | null = null;
    if (this.config.heartbeatEnabled) {
      heartbeatInterval = setInterval(() => {
        if (streamState.active) {
          res.write(':ping\n\n');
        }
      }, this.config.heartbeatIntervalMs);
    }

    // Handle client disconnect
    res.on('close', () => {
      streamState.active = false;
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
      this.logger.info('SSE stream closed', { sessionId, streamId });
    });

    this.logger.info('SSE stream opened', { sessionId, streamId, resuming: !!lastEventId });
  }

  /**
   * Replay messages after Last-Event-ID
   * 
   * Why: Resumability - client can reconnect and receive missed messages
   */
  private replayMessages(res: Response, streamState: SSEStreamState): void {
    const missedMessages = streamState.messageQueue.filter(
      msg => msg.eventId > streamState.lastEventId
    );

    for (const msg of missedMessages) {
      res.write(`id: ${msg.eventId}\n`);
      res.write(`data: ${JSON.stringify(msg.data)}\n\n`);
    }

    this.logger.info('Replayed messages', { count: missedMessages.length, streamId: streamState.streamId });
  }

  /**
   * Send message to client via SSE
   * 
   * Why: Server-initiated requests/notifications
   */
  public sendToClient(sessionId: string, message: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn('Cannot send to client: session not found', { sessionId });
      return;
    }

    const eventId = Date.now();
    const queuedMessage: QueuedMessage = {
      eventId,
      data: message,
      timestamp: Date.now(),
    };

    // Send to all active streams for this session
    for (const [streamId, streamState] of session.sseStreams) {
      if (streamState.active) {
        // Queue for resumability
        streamState.messageQueue.push(queuedMessage);
        
        // Keep only last 100 messages
        if (streamState.messageQueue.length > 100) {
          streamState.messageQueue.shift();
        }
      }
    }
  }

  /**
   * Check if request is initialization
   */
  private isInitializeRequest(body: unknown): boolean {
    if (typeof body !== 'object' || body === null) return false;
    const req = body as Record<string, unknown>;
    return req.method === 'initialize';
  }

  /**
   * Determine message type (request, notification, response)
   */
  private getMessageType(body: unknown): 'request' | 'notification-only' | 'response-only' | 'mixed' | 'unknown' {
    if (Array.isArray(body)) {
      // Batch
      const hasRequest = body.some((msg: unknown) => typeof msg === 'object' && msg !== null && 'method' in msg && 'id' in msg);
      const hasNotification = body.some((msg: unknown) => typeof msg === 'object' && msg !== null && 'method' in msg && !('id' in msg));
      const hasResponse = body.some((msg: unknown) => typeof msg === 'object' && msg !== null && ('result' in msg || 'error' in msg));

      if (hasRequest) return 'request';
      if (hasNotification && !hasResponse) return 'notification-only';
      if (hasResponse && !hasNotification) return 'response-only';
      return 'mixed';
    } else if (typeof body === 'object' && body !== null) {
      const msg = body as Record<string, unknown>;
      if ('method' in msg) {
        return 'id' in msg ? 'request' : 'notification-only';
      }
      if ('result' in msg || 'error' in msg) {
        return 'response-only';
      }
    }
    return 'unknown';
  }

  /**
   * Create new session
   *
   * Why: Stateful sessions for MCP protocol
   */
  private createSession(authToken?: string): string {
    // Validate token if provided (defense in depth)
    if (authToken) {
      this.validateToken(authToken, 'Session auth token');
    }
    
    const sessionId = crypto.randomUUID();
    const session: SessionData = {
      id: sessionId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      sseStreams: new Map(),
      authToken,
    };
    this.sessions.set(sessionId, session);
    this.logger.info('Session created', { sessionId, hasAuthToken: !!authToken });

    // Record metrics
    if (this.metrics) {
      this.metrics.recordSessionCreated();
    }

    return sessionId;
  }

  /**
   * Update session activity timestamp
   */
  private updateSessionActivity(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = Date.now();
    }
  }

  /**
   * Destroy session and cleanup resources
   * 
   * Why: Free memory, close streams
   */
  private destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Close all active SSE streams
      for (const [, streamState] of session.sseStreams) {
        streamState.active = false;
      }
      session.sseStreams.clear();
      
      this.sessions.delete(sessionId);
      this.logger.info('Session destroyed', { sessionId });
      
      // Notify session destruction listeners (for cleanup in MCPServer)
      this.notifySessionDestroyed(sessionId);
      
      // Record metrics
      if (this.metrics) {
        this.metrics.recordSessionDestroyed();
      }
    }
  }

  /**
   * Session destruction listeners for cleanup in other components
   */
  private sessionDestroyedListeners: Array<(sessionId: string) => void> = [];

  /**
   * Register listener for session destruction events
   * 
   * Why: Allows MCPServer to cleanup per-session HTTP clients
   */
  public onSessionDestroyed(listener: (sessionId: string) => void): void {
    this.sessionDestroyedListeners.push(listener);
  }

  /**
   * Notify all listeners about session destruction
   */
  private notifySessionDestroyed(sessionId: string): void {
    for (const listener of this.sessionDestroyedListeners) {
      try {
        listener(sessionId);
      } catch (error) {
        this.logger.error('Session destroyed listener error', error as Error);
      }
    }
  }

  /**
   * Cleanup expired sessions
   * 
   * Why: Prevent memory leaks, enforce session timeout
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      const age = now - session.lastActivityAt;
      if (age > this.config.sessionTimeoutMs) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.destroySession(sessionId);
    }

    if (expiredSessions.length > 0) {
      this.logger.info('Cleaned up expired sessions', { count: expiredSessions.length });
    }
  }


  /**
   * Get auth token from session
   * 
   * Why public: Allows MCPServer to securely access session tokens without breaking encapsulation
   */
  public getSessionToken(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.authToken;
  }

  /**
   * Set message handler for processing incoming JSON-RPC messages
   */
  public setMessageHandler(handler: (message: unknown, sessionId?: string) => Promise<unknown>): void {
    this.messageHandler = handler;
  }

  /**
   * Start HTTP server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          this.logger.info('HTTP transport started', {
            host: this.config.host,
            port: this.config.port,
            heartbeat: this.config.heartbeatEnabled,
            metrics: this.config.metricsEnabled,
          });

          // Start session cleanup interval
          this.cleanupInterval = setInterval(
            () => this.cleanupExpiredSessions(),
            60000 // Check every minute
          );

          resolve();
        });

        this.server.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop HTTP server
   */
  public async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Destroy all sessions
    for (const sessionId of this.sessions.keys()) {
      this.destroySession(sessionId);
    }

    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else {
            this.logger.info('HTTP transport stopped');
            resolve();
          }
        });
      });
    }
  }
}


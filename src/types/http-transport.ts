/**
 * Type definitions for HTTP transport
 * 
 * Based on MCP Specification 2025-03-26
 * https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
 */

import type { Request as ExpressRequest, Response } from 'express';

export interface SessionData {
  id: string;
  createdAt: number;
  lastActivityAt: number;
  sseStreams: Map<string, SSEStreamState>;
  authToken?: string;
}

export interface SSEStreamState {
  streamId: string;
  lastEventId: number;
  messageQueue: QueuedMessage[];
  active: boolean;
  response: Response; // HTTP response object for closing the stream
}

export interface QueuedMessage {
  eventId: number;
  data: unknown;
  timestamp: number;
}

export interface HttpTransportConfig {
  host: string;
  port: number;
  sessionTimeoutMs: number;
  heartbeatEnabled: boolean;
  heartbeatIntervalMs: number;
  metricsEnabled: boolean;
  metricsPath: string;
  allowedOrigins?: string[]; // Allowed origins/CIDR ranges
}

export interface McpRequest extends ExpressRequest {
  sessionId?: string;
}


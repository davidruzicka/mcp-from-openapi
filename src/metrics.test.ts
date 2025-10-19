/**
 * Tests for MetricsCollector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from './metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector({ enabled: true, prefix: 'test_' });
  });

  describe('HTTP Metrics', () => {
    it('should record HTTP requests', async () => {
      metrics.recordHttpRequest('POST', '/mcp', 200, 0.123);
      metrics.recordHttpRequest('POST', '/mcp', 400, 0.045);
      metrics.recordHttpRequest('GET', '/mcp', 200, 0.056);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_http_requests_total');
      expect(output).toContain('method="POST"');
      expect(output).toContain('path="/mcp"');
      expect(output).toContain('status="200"');
    });

    it('should record HTTP request duration', async () => {
      metrics.recordHttpRequest('POST', '/mcp', 200, 0.5);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_http_request_duration_seconds');
      expect(output).toContain('bucket');
    });

    it('should normalize paths for metrics', async () => {
      metrics.recordHttpRequest('GET', '/mcp?sessionId=abc', 200, 0.1);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('path="/mcp"');
      expect(output).not.toContain('sessionId');
    });
  });

  describe('Session Metrics', () => {
    it('should track sessions created', async () => {
      metrics.recordSessionCreated();
      metrics.recordSessionCreated();
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_sessions_created_total 2');
    });

    it('should track sessions destroyed', async () => {
      metrics.recordSessionDestroyed();
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_sessions_destroyed_total 1');
    });

    it('should track active sessions', async () => {
      metrics.recordSessionCreated();
      metrics.recordSessionCreated();
      metrics.recordSessionDestroyed();
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_sessions_active 1');
    });
  });

  describe('Tool Call Metrics', () => {
    it('should record tool calls', async () => {
      metrics.recordToolCall('manage_badges', 'success', 0.5);
      metrics.recordToolCall('manage_badges', 'error', 0.3);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_tool_calls_total');
      expect(output).toContain('tool="manage_badges"');
      expect(output).toContain('status="success"');
      expect(output).toContain('status="error"');
    });

    it('should record tool call duration', async () => {
      metrics.recordToolCall('manage_badges', 'success', 1.5);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_tool_call_duration_seconds');
    });

    it('should record tool call errors', async () => {
      metrics.recordToolCallError('manage_badges', 'ValidationError');
      metrics.recordToolCallError('manage_badges', 'APIError');
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_tool_call_errors_total');
      expect(output).toContain('error_type="ValidationError"');
      expect(output).toContain('error_type="APIError"');
    });
  });

  describe('API Call Metrics', () => {
    it('should record API calls', async () => {
      metrics.recordApiCall('get_project_badges', 200, 0.2);
      metrics.recordApiCall('create_badge', 201, 0.3);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_api_calls_total');
      expect(output).toContain('operation="get_project_badges"');
      expect(output).toContain('status="2xx"');
    });

    it('should record API call duration', async () => {
      metrics.recordApiCall('get_project_badges', 200, 0.5);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_api_call_duration_seconds');
    });

    it('should record API call errors', async () => {
      metrics.recordApiCallError('get_project_badges', 'NetworkError');
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('test_api_call_errors_total');
      expect(output).toContain('error_type="NetworkError"');
    });

    it('should group status codes (2xx, 4xx, 5xx)', async () => {
      metrics.recordApiCall('operation1', 200, 0.1);
      metrics.recordApiCall('operation2', 404, 0.1);
      metrics.recordApiCall('operation3', 500, 0.1);
      
      const output = await metrics.getMetrics();
      
      expect(output).toContain('status="2xx"');
      expect(output).toContain('status="4xx"');
      expect(output).toContain('status="5xx"');
    });
  });

  describe('Disabled Metrics', () => {
    it('should not record metrics when disabled', async () => {
      const disabledMetrics = new MetricsCollector({ enabled: false });
      
      disabledMetrics.recordHttpRequest('POST', '/mcp', 200, 0.1);
      disabledMetrics.recordSessionCreated();
      disabledMetrics.recordToolCall('test', 'success', 0.1);
      
      const output = await disabledMetrics.getMetrics();
      
      expect(output).toBe('# Metrics disabled\n');
    });
  });

  describe('Custom Prefix', () => {
    it('should use custom prefix', async () => {
      const customMetrics = new MetricsCollector({ enabled: true, prefix: 'myapp_' });
      
      customMetrics.recordHttpRequest('POST', '/mcp', 200, 0.1);
      
      const output = await customMetrics.getMetrics();
      
      expect(output).toContain('myapp_http_requests_total');
    });

    it('should use default prefix when not specified', async () => {
      const defaultMetrics = new MetricsCollector({ enabled: true });
      
      defaultMetrics.recordHttpRequest('POST', '/mcp', 200, 0.1);
      
      const output = await defaultMetrics.getMetrics();
      
      expect(output).toContain('mcp_http_requests_total');
    });
  });
});


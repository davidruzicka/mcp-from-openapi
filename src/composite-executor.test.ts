/**
 * Composite executor tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CompositeExecutor } from './composite-executor.js';
import { OpenAPIParser } from './openapi-parser.js';
import type { HttpClient } from './interceptors.js';
import type { CompositeStep } from './types/profile.js';

describe('CompositeExecutor', () => {
  let parser: OpenAPIParser;
  let httpClient: HttpClient;
  let executor: CompositeExecutor;

  beforeEach(() => {
    // Mock OpenAPI parser
    parser = {
      getPath: vi.fn((path: string) => ({
        path,
        operations: {
          get: {
            operationId: `get${path.replace(/\//g, '_')}`,
            method: 'GET',
            path,
            parameters: [],
          },
        },
      })),
    } as unknown as InterceptorConfig;

    // Mock HTTP client
    httpClient = {
      request: vi.fn(async () => ({
        status: 200,
        headers: {},
        body: { id: 123, name: 'test' },
      })),
    } as unknown as InterceptorConfig;

    executor = new CompositeExecutor(parser, httpClient);
  });

  it('stores results at simple paths', async () => {
    const steps: CompositeStep[] = [
      { call: 'GET /projects/1', store_as: 'project' },
    ];

    const result = await executor.execute(steps, { id: '1' });

    expect(result.data).toHaveProperty('project');
    expect(result.data.project).toEqual({ id: 123, name: 'test' });
  });

  it('stores results at nested paths', async () => {
    const steps: CompositeStep[] = [
      { call: 'GET /projects/1', store_as: 'data.project' },
      { call: 'GET /projects/1/issues', store_as: 'data.issues' },
    ];

    const result = await executor.execute(steps, { id: '1' });

    expect(result.data).toHaveProperty('data');
    expect(result.data.data).toHaveProperty('project');
    expect(result.data.data).toHaveProperty('issues');
  });

  it('throws error when trying to overwrite non-object value', async () => {
    // Manually create a result with non-object value to test validation
    const steps: CompositeStep[] = [
      { call: 'GET /projects/1', store_as: 'user' },
      { call: 'GET /projects/1/details', store_as: 'user.profile' },
    ];

    // First call succeeds with string (simulating edge case)
    httpClient.request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: 'string value',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: { id: 456 },
      });

    // Should throw when trying to store user.profile when user is a string
    await expect(executor.execute(steps, { id: '1' }, false))
      .rejects
      .toThrow(/Cannot store at path.*user.*is string/);
  });

  it('handles partial results on error', async () => {
    httpClient.request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: { id: 123 },
      })
      .mockRejectedValueOnce(new Error('API error'));

    const steps: CompositeStep[] = [
      { call: 'GET /projects/1', store_as: 'project' },
      { call: 'GET /projects/1/issues', store_as: 'issues' },
    ];

    const result = await executor.execute(steps, { id: '1' }, true);

    expect(result.completed_steps).toBe(1);
    expect(result.total_steps).toBe(2);
    expect(result.data).toHaveProperty('project');
    expect(result.data).toHaveProperty('issues_error');
    expect(result.errors).toHaveLength(1);
  });

  it('throws error immediately when partial results disabled', async () => {
    httpClient.request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: { id: 123 },
      })
      .mockRejectedValueOnce(new Error('API error'));

    const steps: CompositeStep[] = [
      { call: 'GET /projects/1', store_as: 'project' },
      { call: 'GET /projects/1/issues', store_as: 'issues' },
    ];

    await expect(executor.execute(steps, { id: '1' }, false))
      .rejects
      .toThrow(/Composite step 2\/2 failed/);
  });

  it('includes error details in partial results', async () => {
    httpClient.request = vi.fn().mockRejectedValue(new Error('Network timeout'));

    const steps: CompositeStep[] = [
      { call: 'GET /projects/1', store_as: 'project' },
    ];

    const result = await executor.execute(steps, { id: '1' }, true);

    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toMatchObject({
      step_index: 0,
      step_call: 'GET /projects/1',
      error: 'Network timeout',
    });
    expect(result.errors![0].timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});


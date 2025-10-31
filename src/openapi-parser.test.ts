/**
 * Tests for OpenAPI parser
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { OpenAPIParser } from './openapi-parser.js';
import path from 'path';

describe('OpenAPIParser', () => {
  let parser: OpenAPIParser;

  beforeAll(async () => {
    parser = new OpenAPIParser();
    const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');
    await parser.load(specPath);
  });

  it('should load GitLab OpenAPI spec', () => {
    expect(parser).toBeDefined();
  });

  it('should find operation by operationId', () => {
    const operation = parser.getOperation('getApiV4ProjectsIdBadges');
    expect(operation).toBeDefined();
    expect(operation?.method).toBe('GET');
    expect(operation?.path).toBe('/projects/{id}/badges');
  });

  it('should extract path parameters', () => {
    const operation = parser.getOperation('getApiV4ProjectsIdBadgesBadgeId');
    expect(operation?.parameters).toBeDefined();
    
    const pathParams = operation?.parameters.filter(p => p.in === 'path');
    expect(pathParams?.length).toBeGreaterThan(0);
    expect(pathParams?.some(p => p.name === 'id')).toBe(true);
    expect(pathParams?.some(p => p.name === 'badge_id')).toBe(true);
  });

  it('should extract query parameters', () => {
    const operation = parser.getOperation('getApiV4ProjectsIdBadges');
    const queryParams = operation?.parameters.filter(p => p.in === 'query');
    
    expect(queryParams?.some(p => p.name === 'page')).toBe(true);
    expect(queryParams?.some(p => p.name === 'per_page')).toBe(true);
  });

  it('should extract request body for POST operations', () => {
    const operation = parser.getOperation('postApiV4ProjectsIdBadges');
    expect(operation?.requestBody).toBeDefined();
    expect(operation?.requestBody?.required).toBe(true);
  });

  it('should get base URL from servers', () => {
    const baseUrl = parser.getBaseUrl();
    expect(baseUrl).toContain('gitlab.com/api/v4');
  });

  it('should list all operations', () => {
    const operations = parser.getAllOperations();
    expect(operations.length).toBeGreaterThan(0);
    expect(operations.every(op => op.operationId)).toBe(true);
  });

  it('should find operations by tag', () => {
    const operations = parser.getAllOperations();
    const badgeOps = operations.filter(op => op.tags?.includes('badges'));
    expect(badgeOps.length).toBeGreaterThan(0);
  });

  it('should extract security scheme from GitLab spec', () => {
    const security = parser.getSecurityScheme();
    expect(security).toBeDefined();
    // GitLab uses apiKey in header (PRIVATE-TOKEN)
    expect(['bearer', 'apiKey']).toContain(security?.type);
  });
});

describe('OpenAPIParser - Security Schemes', () => {
  it('should parse bearer token auth', async () => {
    const parser = new OpenAPIParser();
    
    // Mock spec with bearer auth directly without loading file
    (parser as any).spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
          },
        },
      },
      paths: {},
    };
    (parser as any).buildIndex();

    const security = parser.getSecurityScheme();
    expect(security).toEqual({
      type: 'bearer',
      scheme: 'bearer',
    });
  });

  it('should parse API key in header', async () => {
    const parser = new OpenAPIParser();
    await parser.load('test-spec.yaml').catch(() => {});
    
    (parser as any).spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      security: [{ apiKeyAuth: [] }],
      components: {
        securitySchemes: {
          apiKeyAuth: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
          },
        },
      },
      paths: {},
    };
    (parser as any).buildIndex();

    const security = parser.getSecurityScheme();
    expect(security).toEqual({
      type: 'apiKey',
      name: 'X-API-Key',
      in: 'header',
    });
  });

  it('should parse API key in query', async () => {
    const parser = new OpenAPIParser();
    await parser.load('test-spec.yaml').catch(() => {});
    
    (parser as any).spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      security: [{ apiKeyAuth: [] }],
      components: {
        securitySchemes: {
          apiKeyAuth: {
            type: 'apiKey',
            name: 'api_key',
            in: 'query',
          },
        },
      },
      paths: {},
    };
    (parser as any).buildIndex();

    const security = parser.getSecurityScheme();
    expect(security).toEqual({
      type: 'apiKey',
      name: 'api_key',
      in: 'query',
    });
  });

  it('should return undefined for public API (no security)', async () => {
    const parser = new OpenAPIParser();
    await parser.load('test-spec.yaml').catch(() => {});
    
    (parser as any).spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      paths: {},
    };
    (parser as any).buildIndex();

    const security = parser.getSecurityScheme();
    expect(security).toBeUndefined();
  });

  it('should map OAuth2 to bearer', async () => {
    const parser = new OpenAPIParser();
    await parser.load('test-spec.yaml').catch(() => {});
    
    (parser as any).spec = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '1.0' },
      security: [{ oauth2: [] }],
      components: {
        securitySchemes: {
          oauth2: {
            type: 'oauth2',
            flows: {
              implicit: {
                authorizationUrl: 'https://example.com/oauth',
                scopes: {},
              },
            },
          },
        },
      },
      paths: {},
    };
    (parser as any).buildIndex();

    const security = parser.getSecurityScheme();
    expect(security).toEqual({
      type: 'bearer',
      scheme: 'bearer',
    });
  });
});


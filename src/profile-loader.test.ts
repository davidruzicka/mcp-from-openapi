/**
 * Tests for profile loader
 */

import { describe, it, expect } from 'vitest';
import { ProfileLoader } from './profile-loader.js';
import path from 'path';

describe('ProfileLoader', () => {
  it('should load valid GitLab profile', async () => {
    const loader = new ProfileLoader();
    const profilePath = path.join(process.cwd(), 'profiles/gitlab/developer-profile.json');
    
    const profile = await loader.load(profilePath);
    
    expect(profile.profile_name).toBe('gitlab-developer');
    expect(profile.tools.length).toBeGreaterThan(0);
    expect(profile.interceptors).toBeDefined();
  });

  it('should validate required_for references', async () => {
    const loader = new ProfileLoader();
    const profilePath = path.join(process.cwd(), 'profiles/gitlab/developer-profile.json');
    
    const profile = await loader.load(profilePath);
    const badgeTool = profile.tools.find(t => t.name === 'manage_project_badges');
    
    expect(badgeTool).toBeDefined();
    expect(badgeTool?.parameters.badge_id.required_for).toContain('get');
    expect(badgeTool?.parameters.link_url.required_for).toContain('create');
  });

  it('should reject invalid profile', async () => {
    const loader = new ProfileLoader();

    // Create invalid profile (missing required fields)
    const invalidJson = JSON.stringify({
      profile_name: 'test',
      tools: [
        {
          name: 'test_tool',
          // missing description
          parameters: {}
        }
      ]
    });

    await expect(async () => {
      const fs = await import('fs/promises');
      const tmpPath = '/tmp/invalid-profile.json';
      await fs.writeFile(tmpPath, invalidJson);
      await loader.load(tmpPath);
    }).rejects.toThrow();
  });

  describe('Composite steps DAG validation', () => {
    it('should accept valid composite steps without dependencies', async () => {
      const loader = new ProfileLoader();

      const validProfileJson = JSON.stringify({
        profile_name: 'test',
        tools: [
          {
            name: 'valid_composite',
            description: 'Valid composite tool',
            composite: true,
            parameters: {
              id: { type: 'string', description: 'ID' }
            },
            steps: [
              { call: 'GET /api/1', store_as: 'result1' },
              { call: 'GET /api/2', store_as: 'result2' }
            ]
          }
        ]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/valid-dag-profile.json';
      await fs.writeFile(tmpPath, validProfileJson);

      const profile = await loader.load(tmpPath);
      expect(profile.tools[0].steps).toHaveLength(2);
    });

    it('should accept valid composite steps with dependencies', async () => {
      const loader = new ProfileLoader();

      const validProfileJson = JSON.stringify({
        profile_name: 'test',
        tools: [
          {
            name: 'valid_dag_composite',
            description: 'Valid DAG composite tool',
            composite: true,
            parameters: {
              id: { type: 'string', description: 'ID' }
            },
            steps: [
              { call: 'GET /api/project', store_as: 'project' },
              {
                call: 'GET /api/mrs',
                store_as: 'mrs',
                depends_on: ['project']
              },
              {
                call: 'GET /api/issues',
                store_as: 'issues',
                depends_on: ['project']
              }
            ]
          }
        ]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/valid-dag-profile.json';
      await fs.writeFile(tmpPath, validProfileJson);

      const profile = await loader.load(tmpPath);
      expect(profile.tools[0].steps).toHaveLength(3);
    });

    it('should reject composite steps with circular dependencies', async () => {
      const loader = new ProfileLoader();

      const circularProfileJson = JSON.stringify({
        profile_name: 'test',
        tools: [
          {
            name: 'circular_composite',
            description: 'Circular dependency composite tool',
            composite: true,
            parameters: {
              id: { type: 'string', description: 'ID' }
            },
            steps: [
              { call: 'GET /api/a', store_as: 'a', depends_on: ['c'] },
              { call: 'GET /api/b', store_as: 'b', depends_on: ['a'] },
              { call: 'GET /api/c', store_as: 'c', depends_on: ['b'] }
            ]
          }
        ]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/circular-dag-profile.json';
      await fs.writeFile(tmpPath, circularProfileJson);

      await expect(loader.load(tmpPath)).rejects.toThrow(
        'Circular dependency detected in composite steps of tool \'circular_composite\''
      );
    });

    it('should reject composite steps with self-dependency', async () => {
      const loader = new ProfileLoader();

      const selfDepProfileJson = JSON.stringify({
        profile_name: 'test',
        tools: [
          {
            name: 'self_dep_composite',
            description: 'Self dependency composite tool',
            composite: true,
            parameters: {
              id: { type: 'string', description: 'ID' }
            },
            steps: [
              { call: 'GET /api/a', store_as: 'a', depends_on: ['a'] }
            ]
          }
        ]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/self-dep-profile.json';
      await fs.writeFile(tmpPath, selfDepProfileJson);

      await expect(loader.load(tmpPath)).rejects.toThrow(
        'Circular dependency detected in composite steps of tool \'self_dep_composite\''
      );
    });

    it('should reject composite steps with missing dependency', async () => {
      const loader = new ProfileLoader();

      const missingDepProfileJson = JSON.stringify({
        profile_name: 'test',
        tools: [
          {
            name: 'missing_dep_composite',
            description: 'Missing dependency composite tool',
            composite: true,
            parameters: {
              id: { type: 'string', description: 'ID' }
            },
            steps: [
              { call: 'GET /api/a', store_as: 'a', depends_on: ['nonexistent'] }
            ]
          }
        ]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/missing-dep-profile.json';
      await fs.writeFile(tmpPath, missingDepProfileJson);

      await expect(loader.load(tmpPath)).rejects.toThrow(
        'depends on \'nonexistent\' but no step produces \'nonexistent\''
      );
    });
  });

  it('should create default profile', async () => {
    const parser = new (await import('./openapi-parser.js')).OpenAPIParser();
    await parser.load('profiles/gitlab/openapi.yaml');
    const profile = ProfileLoader.createDefaultProfile('my-api', parser);
    expect(profile.profile_name).toBe('my-api');
    expect(profile.tools.length).toBeGreaterThan(0);
    expect(profile.description).toContain('Auto-generated default profile');
  });

  it('should shorten tool names when strategy is configured', async () => {
    const parser = new (await import('./openapi-parser.js')).OpenAPIParser();
    await parser.load('profiles/gitlab/openapi.yaml');
    
    // Set env vars for shortening
    const oldStrategy = process.env.MCP_TOOLNAME_STRATEGY;
    const oldWarn = process.env.MCP_TOOLNAME_WARN_ONLY;
    const oldMax = process.env.MCP_TOOLNAME_MAX;
    
    process.env.MCP_TOOLNAME_STRATEGY = 'hash';
    process.env.MCP_TOOLNAME_WARN_ONLY = 'false';
    process.env.MCP_TOOLNAME_MAX = '30';
    
    try {
      const profile = ProfileLoader.createDefaultProfile('my-api', parser);
      
      // All tool names should be ≤ 30 characters
      profile.tools.forEach(tool => {
        expect(tool.name.length).toBeLessThanOrEqual(30);
      });
      
      // Should have some tools with shortened names
      const hasShortNames = profile.tools.some(t => t.name.length < 20);
      expect(hasShortNames).toBe(true);
    } finally {
      // Restore env vars
      if (oldStrategy !== undefined) process.env.MCP_TOOLNAME_STRATEGY = oldStrategy;
      else delete process.env.MCP_TOOLNAME_STRATEGY;
      if (oldWarn !== undefined) process.env.MCP_TOOLNAME_WARN_ONLY = oldWarn;
      else delete process.env.MCP_TOOLNAME_WARN_ONLY;
      if (oldMax !== undefined) process.env.MCP_TOOLNAME_MAX = oldMax;
      else delete process.env.MCP_TOOLNAME_MAX;
    }
  });

  describe('Operation keys validation', () => {
    it('should accept direct action enum values', async () => {
      const loader = new ProfileLoader();

      const validProfileJson = JSON.stringify({
        profile_name: 'test',
        base_url: 'https://api.example.com',
        tools: [{
          name: 'test_tool',
          description: 'Test tool',
          operations: {
            'list': 'getTest',
            'get': 'getTestId',
            'create': 'postTest'
          },
          parameters: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'create'],
              description: 'Action',
              required: true
            }
          }
        }]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/valid-ops-profile.json';
      await fs.writeFile(tmpPath, validProfileJson);

      const profile = await loader.load(tmpPath);
      expect(profile.tools[0].operations).toHaveProperty('list');
      expect(profile.tools[0].operations).toHaveProperty('get');
      expect(profile.tools[0].operations).toHaveProperty('create');
    });

    it('should accept {action}_{resourceType} composite keys', async () => {
      const loader = new ProfileLoader();

      const validProfileJson = JSON.stringify({
        profile_name: 'test',
        base_url: 'https://api.example.com',
        tools: [{
          name: 'test_tool',
          description: 'Test tool',
          operations: {
            'list_project': 'getProjects',
            'list_group': 'getGroups',
            'get_project': 'getProjectId'
          },
          parameters: {
            action: {
              type: 'string',
              enum: ['list', 'get'],
              description: 'Action',
              required: true
            },
            resource_type: {
              type: 'string',
              enum: ['project', 'group'],
              description: 'Resource type',
              required: true
            }
          }
        }]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/valid-composite-ops-profile.json';
      await fs.writeFile(tmpPath, validProfileJson);

      const profile = await loader.load(tmpPath);
      expect(profile.tools[0].operations).toHaveProperty('list_project');
      expect(profile.tools[0].operations).toHaveProperty('list_group');
      expect(profile.tools[0].operations).toHaveProperty('get_project');
    });

    it('should reject unknown operation key', async () => {
      const loader = new ProfileLoader();

      const invalidProfileJson = JSON.stringify({
        profile_name: 'test',
        base_url: 'https://api.example.com',
        tools: [{
          name: 'test_tool',
          description: 'Test tool',
          operations: {
            'invalid_action': 'getTest' // 'invalid_action' not in action enum
          },
          parameters: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'create'],
              description: 'Action',
              required: true
            }
          }
        }]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/invalid-ops-profile.json';
      await fs.writeFile(tmpPath, invalidProfileJson);

      await expect(loader.load(tmpPath)).rejects.toThrow('Invalid operation key \'invalid_action\'');
    });

    it('should reject invalid composite key format', async () => {
      const loader = new ProfileLoader();

      const invalidProfileJson = JSON.stringify({
        profile_name: 'test',
        base_url: 'https://api.example.com',
        tools: [{
          name: 'test_tool',
          description: 'Test tool',
          operations: {
            'list_invalid_resource': 'getTest' // 'invalid_resource' not in resource_type enum
          },
          parameters: {
            action: {
              type: 'string',
              enum: ['list', 'get'],
              description: 'Action',
              required: true
            },
            resource_type: {
              type: 'string',
              enum: ['project', 'group'],
              description: 'Resource type',
              required: true
            }
          }
        }]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/invalid-composite-ops-profile.json';
      await fs.writeFile(tmpPath, invalidProfileJson);

      await expect(loader.load(tmpPath)).rejects.toThrow('Invalid operation key \'list_invalid_resource\'');
    });

    it('should provide helpful suggestions for typos', async () => {
      const loader = new ProfileLoader();

      const typoProfileJson = JSON.stringify({
        profile_name: 'test',
        base_url: 'https://api.example.com',
        tools: [{
          name: 'test_tool',
          description: 'Test tool',
          operations: {
            'creat': 'postTest' // typo: 'creat' instead of 'create'
          },
          parameters: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'create'],
              description: 'Action',
              required: true
            }
          }
        }]
      });

      const fs = await import('fs/promises');
      const tmpPath = '/tmp/typo-ops-profile.json';
      await fs.writeFile(tmpPath, typoProfileJson);

      await expect(loader.load(tmpPath)).rejects.toThrow('Did you mean one of: create?');
    });
  });

  it('should warn when generated tool exceeds 60 parameters', async () => {
    const warnSpy = (await import('vitest')).vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Fake parser with one operation having 61 query parameters
    const fakeParser: any = {
      getAllOperations: () => {
        const params = Array.from({ length: 61 }).map((_, i) => ({
          name: `p${i}`,
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: `Param ${i}`,
        }));

        return [{
          operationId: 'op_many_params',
          method: 'get',
          path: '/test',
          parameters: params,
          summary: 'Many params',
        }];
      }
    };

    const profile = ProfileLoader.createDefaultProfile('test', fakeParser);
    expect(profile.tools.length).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('>60');

    warnSpy.mockRestore();
  });
});


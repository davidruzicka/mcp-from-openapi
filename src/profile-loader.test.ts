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

  it('should create default profile', () => {
    const profile = ProfileLoader.createDefaultProfile('my-api');
    expect(profile.profile_name).toBe('my-api');
    expect(profile.tools).toEqual([]);
  });
});


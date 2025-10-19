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

  it('should create default profile', () => {
    const profile = ProfileLoader.createDefaultProfile('my-api');
    expect(profile.profile_name).toBe('my-api');
    expect(profile.tools).toEqual([]);
  });
});


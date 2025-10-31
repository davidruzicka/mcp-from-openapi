/**
 * Unit tests for MCPServer
 *
 * Why: Test server initialization, tool listing, and behavior without profile.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { MCPServer } from './mcp-server.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('MCPServer', () => {
  let server: MCPServer;

  beforeEach(() => {
    server = new MCPServer();
  });

  describe('initialize without profile', () => {
    it('should initialize successfully without profile path', async () => {
      const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');

      await expect(server.initialize(specPath)).resolves.toBeUndefined();
    });

    it('should have auto-generated tools when no profile is provided', async () => {
      const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');
      await server.initialize(specPath);

      expect(server['profile']!.tools.length).toBeGreaterThan(0);
      // Check that tools have proper structure
      const firstTool = server['profile']!.tools[0];
      expect(firstTool.name).toBeDefined();
      expect(firstTool.description).toBeDefined();
      expect(firstTool.operations).toBeDefined();
      expect(firstTool.parameters).toBeDefined();
    });

    it('should use default profile with auto-generated tools', async () => {
      const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');
      await server.initialize(specPath);

      expect(server['profile']!.profile_name).toBe('default');
      expect(server['profile']!.tools.length).toBeGreaterThan(0);
      expect(server['profile']!.description).toContain('Auto-generated default profile');
    });
  });

  describe('initialize with profile', () => {
    it('should load profile and provide tools', async () => {
      const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');
      const profilePath = path.join(process.cwd(), 'profiles/gitlab/developer-profile.json');

      await server.initialize(specPath, profilePath);

      expect(server['profile']!.tools.length).toBeGreaterThan(0);
    });
  });

  describe('auto-generated tools from OpenAPI spec', () => {
    beforeEach(async () => {
      const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');
      await server.initialize(specPath);
    });

    it('should generate tools with operationId as name', () => {
      const tools = server['profile']!.tools;
      expect(tools.length).toBeGreaterThan(0);

      // All tools should have operationId as name
      tools.forEach(tool => {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
      });
    });

    it('should generate tools with meaningful descriptions', () => {
      const tools = server['profile']!.tools;

      tools.forEach(tool => {
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
      });
    });

    it('should generate tools with operations mapping', () => {
      const tools = server['profile']!.tools;

      tools.forEach(tool => {
        expect(tool.operations).toBeDefined();
        expect(typeof tool.operations).toBe('object');
        expect(tool.operations).toHaveProperty('execute');
        expect(typeof (tool.operations as any).execute).toBe('string');
      });
    });

    it('should generate tools with parameters from OpenAPI spec', () => {
      const tools = server['profile']!.tools;

      // Find a tool that should have parameters
      const toolWithParams = tools.find(t => Object.keys(t.parameters).length > 0);
      expect(toolWithParams).toBeDefined();

      if (toolWithParams) {
        Object.values(toolWithParams.parameters).forEach(param => {
          expect(param.type).toBeDefined();
          expect(param.description).toBeDefined();
          expect(typeof param.required).toBe('boolean');
        });
      }
    });

    it('should generate reasonable number of tools from GitLab spec', () => {
      const tools = server['profile']!.tools;
      // GitLab spec has around 87 operations, should generate similar number
      expect(tools.length).toBeGreaterThan(50);
      expect(tools.length).toBeLessThan(200);
    });
  });

  describe('error sanitization', () => {
    it('should return generic error message from HTTP handleToolCall', async () => {
      const specPath = path.join(process.cwd(), 'profiles/gitlab/openapi.yaml');
      await server.initialize(specPath);

      const message = {
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/call',
        params: {
          name: 'non_existing_tool',
          arguments: {}
        }
      };

      const response = await (server as any)['handleToolCall'](message, 'test-session');
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('message');
      expect(response.error.message).toBe('Internal error');
    });
  });

  describe('security warnings', () => {
    it('should warn when binding non-localhost with empty ALLOWED_ORIGINS', async () => {
      const messages: string[] = [];
      const testLogger: any = {
        debug: () => {},
        info: () => {},
        warn: (msg: string) => { messages.push(msg); },
        error: () => {},
      };

      const serverWithLogger = new MCPServer(testLogger);

      const prev = process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOWED_ORIGINS;
      try {
        await serverWithLogger.runHttp('0.0.0.0', 0);
        expect(messages.find(m => m.includes('ALLOWED_ORIGINS'))).toBeDefined();
      } finally {
        await serverWithLogger.stop();
        process.env.ALLOWED_ORIGINS = prev;
      }
    });
  });
});

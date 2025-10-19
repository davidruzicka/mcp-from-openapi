/**
 * MCP tool generator from profile definitions
 * 
 * Why: Translates profile config into MCP SDK tool definitions. Handles both
 * simple (single operation) and composite (multi-step) tools.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition, ParameterDefinition } from './types/profile.js';
import type { OpenAPIParser } from './openapi-parser.js';

export class ToolGenerator {
  constructor(private parser: OpenAPIParser) {}

  /**
   * Generate MCP tool from profile definition
   */
  generateTool(toolDef: ToolDefinition): Tool {
    const inputSchema = this.generateInputSchema(toolDef);

    return {
      name: toolDef.name,
      description: toolDef.description,
      inputSchema,
    };
  }

  /**
   * Generate JSON Schema for tool parameters
   * 
   * Why JSON Schema: MCP SDK expects JSON Schema for parameter validation.
   * LLM uses schema to understand what parameters are needed.
   */
  private generateInputSchema(toolDef: ToolDefinition): Tool['inputSchema'] {
    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];

    for (const [name, param] of Object.entries(toolDef.parameters)) {
      properties[name] = this.parameterToJsonSchema(param);

      // Add to required if unconditionally required
      if (param.required) {
        required.push(name);
      }

      // Add conditional requirement hints in description
      if (param.required_for && param.required_for.length > 0) {
        const existing = properties[name].description || '';
        properties[name].description = existing +
          ` Required when action is: ${param.required_for.join(', ')}.`;
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  /**
   * Convert parameter definition to JSON Schema
   */
  private parameterToJsonSchema(param: ParameterDefinition): Record<string, unknown> {
    const schema: Record<string, unknown> = {
      type: param.type,
      description: param.description,
    };

    if (param.enum) {
      schema.enum = param.enum;
    }

    if (param.default !== undefined) {
      schema.default = param.default;
    }

    if (param.type === 'array' && param.items) {
      schema.items = { type: param.items.type };
    }

    return schema;
  }

  /**
   * Validate tool arguments against parameter definitions
   * 
   * Why manual validation: Checks conditional requirements (required_for)
   * which JSON Schema can't express directly.
   */
  validateArguments(toolDef: ToolDefinition, args: Record<string, unknown>): void {
    for (const [name, param] of Object.entries(toolDef.parameters)) {
      const value = args[name];

      // Check unconditional required
      if (param.required && value === undefined) {
        throw new Error(`Missing required parameter: ${name}`);
      }

      // Check conditional required
      if (param.required_for && param.required_for.length > 0) {
        const action = args['action'] as string | undefined;
        if (action && param.required_for.includes(action) && value === undefined) {
          throw new Error(
            `Parameter '${name}' is required for action '${action}'`
          );
        }
      }

      // Validate enum
      if (value !== undefined && param.enum && !param.enum.includes(String(value))) {
        throw new Error(
          `Invalid value for ${name}. Must be one of: ${param.enum.join(', ')}`
        );
      }
    }
  }

  /**
   * Map tool action to OpenAPI operation ID
   * 
   * Why: Single tool with 'action' parameter maps to multiple operations.
   * Example: manage_badges + action=create => postApiV4ProjectsIdBadges
   */
  mapActionToOperation(toolDef: ToolDefinition, args: Record<string, unknown>): string | undefined {
    if (!toolDef.operations) return undefined;

    const action = args['action'] as string | undefined;
    
    if (!action) {
      // If single operation, use it directly
      const operations = Object.values(toolDef.operations);
      return operations.length === 1 ? operations[0] : undefined;
    }

    // For resource_type discrimination (e.g., project vs group)
    const resourceType = args['resource_type'] as string | undefined;
    
    if (resourceType) {
      // Try resource-specific operation first
      const key = `${action}_${resourceType}`;
      if (toolDef.operations[key]) {
        return toolDef.operations[key];
      }
    }

    return toolDef.operations[action];
  }
}


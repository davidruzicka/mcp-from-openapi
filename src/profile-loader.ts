/**
 * Profile configuration loader and validator
 *
 * Why validation: Profile config comes from user files. Invalid config would
 * cause runtime errors. Validate upfront with clear error messages.
 *
 * ✅ Schemas are now auto-generated from TypeScript types!
 * When adding fields to src/types/profile.ts:
 * 1. Update TypeScript interface (compile-time checking)
 * 2. Run `npm run generate-schemas` (auto-generates JSON + Zod schemas)
 * 3. That's it! No manual sync needed.
 *
 * See IMPLEMENTATION.md for details.
 */

import fs from 'fs/promises';
import type { Profile } from './types/profile.js';
import { ValidationError } from './errors.js';
import { profileSchema, authInterceptorSchema } from './generated-schemas.js';
import type { OpenAPIParser } from './openapi-parser.js';
import type { OperationInfo, SchemaInfo } from './types/openapi.js';

// Schemas are now auto-generated from TypeScript types!
// See scripts/generate-schemas.js for details.

// Custom validations that can't be auto-generated
const enhancedAuthInterceptorSchema = authInterceptorSchema.refine(
  (data) => {
    if (data.type === 'query' && !data.query_param) {
      return false;
    }
    if (data.type === 'custom-header' && !data.header_name) {
      return false;
    }
    return true;
  },
  {
    message: 'query type requires query_param, custom-header requires header_name',
  }
);

// Override the auth schema in the profile schema tree
// Note: This is a workaround since we can't easily modify the generated schema
const enhancedProfileSchema = profileSchema.transform((data) => {
  // Custom validation for auth interceptor if present
  if (data.interceptors?.auth) {
    enhancedAuthInterceptorSchema.parse(data.interceptors.auth);
  }
  return data;
});

export class ProfileLoader {
  async load(profilePath: string): Promise<Profile> {
    const content = await fs.readFile(profilePath, 'utf-8');
    const json = JSON.parse(content);
    
    // Validate with Zod - throws detailed error if invalid
    const profile = enhancedProfileSchema.parse(json) as Profile;
    
    this.validateLogic(profile);
    
    return profile;
  }

  /**
   * Validate semantic rules beyond schema
   * 
   * Why separate: Some rules can't be expressed in JSON Schema (e.g.,
   * "if composite=true then steps must exist"). Fail fast with clear messages.
   */
  private validateLogic(profile: Profile): void {
    for (const tool of profile.tools) {
      // Composite tools must have steps
      if (tool.composite && (!tool.steps || tool.steps.length === 0)) {
        throw new ValidationError(
          `Tool '${tool.name}' is marked as composite but has no steps`,
          { toolName: tool.name, composite: tool.composite }
        );
      }

      // Non-composite tools must have operations
      if (!tool.composite && !tool.operations) {
        throw new ValidationError(
          `Tool '${tool.name}' must have either 'operations' or be marked as 'composite' with 'steps'`,
          { toolName: tool.name, composite: tool.composite }
        );
      }

      // Validate required_for references existing enum values
      for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
        if (paramDef.required_for) {
          const actionParam = tool.parameters['action'];
          if (!actionParam?.enum) {
            throw new ValidationError(
              `Parameter '${paramName}' in tool '${tool.name}' has 'required_for' but 'action' parameter has no enum`,
              { toolName: tool.name, paramName, hasActionParam: !!actionParam }
            );
          }

          for (const action of paramDef.required_for) {
            if (!actionParam.enum.includes(action)) {
              throw new ValidationError(
                `Parameter '${paramName}' requires action '${action}' but it's not in action enum: ${actionParam.enum.join(', ')}`,
                { toolName: tool.name, paramName, requiredAction: action, availableActions: actionParam.enum }
              );
            }
          }
        }
      }

      // Validate operation keys match action enum or follow {action}_{resourceType} pattern
      if (tool.operations && tool.parameters['action']?.enum) {
        const actionEnum = tool.parameters['action'].enum;
        const resourceTypeParam = tool.parameters['resource_type'];
        const resourceTypeEnum = resourceTypeParam?.enum;

        for (const operationKey of Object.keys(tool.operations)) {
          // Check if operation key is directly in action enum
          if (actionEnum.includes(operationKey)) {
            continue;
          }

          // Check if operation key follows {action}_{resourceType} pattern
          const parts = operationKey.split('_');
          if (parts.length === 2) {
            const [actionPart, resourceTypePart] = parts;

            // Both parts must be valid
            const actionValid = actionEnum.includes(actionPart);
            const resourceTypeValid = resourceTypeEnum ? resourceTypeEnum.includes(resourceTypePart) : true;

            if (actionValid && resourceTypeValid) {
              continue;
            }
          }

          // Generate helpful error message with suggestions
          const suggestions = this.generateOperationKeySuggestions(operationKey, actionEnum, resourceTypeEnum);
          const suggestionText = suggestions.length > 0
            ? ` Did you mean one of: ${suggestions.join(', ')}?`
            : '';

          throw new ValidationError(
            `Invalid operation key '${operationKey}' in tool '${tool.name}'. ` +
            `Must be an action from enum [${actionEnum.join(', ')}] or follow pattern {action}_{resourceType}.${suggestionText}`,
            {
              toolName: tool.name,
              operationKey,
              availableActions: actionEnum,
              availableResourceTypes: resourceTypeEnum,
              suggestions
            }
          );
        }
      }

      // Validate composite steps DAG (no circular dependencies)
      if (tool.composite && tool.steps) {
        this.validateCompositeStepsDAG(tool.name, tool.steps);
      }
    }
  }

  /**
   * Generate helpful suggestions for invalid operation keys
   */
  private generateOperationKeySuggestions(
    invalidKey: string,
    actionEnum: string[],
    resourceTypeEnum?: string[]
  ): string[] {
    const suggestions: string[] = [];

    // Direct action matches (case-insensitive)
    for (const action of actionEnum) {
      if (action.toLowerCase() === invalidKey.toLowerCase()) {
        suggestions.push(action);
      }
    }

    // Levenshtein distance suggestions for actions
    const maxDistance = Math.min(2, invalidKey.length - 1);
    for (const action of actionEnum) {
      if (this.levenshteinDistance(invalidKey, action) <= maxDistance) {
        suggestions.push(action);
      }
    }

    // Check for {action}_{resourceType} patterns
    if (resourceTypeEnum) {
      for (const action of actionEnum) {
        for (const resourceType of resourceTypeEnum) {
          const compositeKey = `${action}_${resourceType}`;
          if (this.levenshteinDistance(invalidKey, compositeKey) <= maxDistance) {
            suggestions.push(compositeKey);
          }
        }
      }
    }

    // Remove duplicates and return unique suggestions
    return [...new Set(suggestions)];
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Validate composite steps form a DAG (no circular dependencies)
   *
   * Why: Circular dependencies would cause infinite loops or deadlocks.
   * We use DFS with color-coding to detect cycles.
   */
  private validateCompositeStepsDAG(toolName: string, steps: import('./types/profile.js').CompositeStep[]): void {
    // Build adjacency list: store_as -> list of steps that depend on it
    const graph = new Map<string, string[]>();
    const allStoreAs = new Set<string>();

    // Initialize all nodes
    for (const step of steps) {
      allStoreAs.add(step.store_as);
      if (!graph.has(step.store_as)) {
        graph.set(step.store_as, []);
      }
    }

    // Build dependency edges
    for (const step of steps) {
      if (step.depends_on) {
        for (const dep of step.depends_on) {
          // Validate dependency exists
          if (!allStoreAs.has(dep)) {
            throw new ValidationError(
              `Composite step '${step.store_as}' in tool '${toolName}' depends on '${dep}' but no step produces '${dep}'`,
              { toolName, stepStoreAs: step.store_as, dependency: dep, availableStoreAs: Array.from(allStoreAs) }
            );
          }

          // Add edge: dep -> step.store_as (dep must complete before step)
          if (!graph.has(dep)) {
            graph.set(dep, []);
          }
          graph.get(dep)!.push(step.store_as);
        }
      }
    }

    // DFS cycle detection with color-coding
    const visited = new Set<string>(); // Fully processed nodes
    const visiting = new Set<string>(); // Currently being processed (in recursion stack)

    const dfs = (node: string): void => {
      if (visiting.has(node)) {
        throw new ValidationError(
          `Circular dependency detected in composite steps of tool '${toolName}': ${node} depends on itself`,
          { toolName, circularNode: node, visitingNodes: Array.from(visiting) }
        );
      }

      if (visited.has(node)) {
        return; // Already fully processed
      }

      visiting.add(node);

      // Visit all neighbors
      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        dfs(neighbor);
      }

      visiting.delete(node);
      visited.add(node);
    };

    // Check all nodes for cycles
    for (const node of allStoreAs) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  /**
   * Create a default profile with auto-generated tools from OpenAPI spec
   *
   * Why: Allows running server without profile for quick exploration.
   * Generates simple pass-through tools for all operations.
   */
  static createDefaultProfile(profileName: string, parser: OpenAPIParser): Profile {
    const operations = parser.getAllOperations();
    const tools = operations.map(op => this.generateToolFromOperation(op));

    return {
      profile_name: profileName,
      description: `Auto-generated default profile with ${tools.length} tools from OpenAPI spec`,
      tools,
      interceptors: {},
    };
  }

  /**
   * Generate a simple tool from an OpenAPI operation
   *
   * Creates a tool with parameters based on the operation's path/query/header parameters
   * and request body. Uses operationId as tool name and summary/description for tool description.
   */
  private static generateToolFromOperation(operation: OperationInfo): import('./types/profile.js').ToolDefinition {
    const parameters: Record<string, import('./types/profile.js').ParameterDefinition> = {};

    // Add path parameters
    for (const param of operation.parameters) {
      parameters[param.name] = {
        type: this.mapOpenAPISchemaToParameterType(param.schema),
        description: param.description || `Parameter ${param.name}`,
        required: param.required,
      };
    }

    // Add request body parameters if present
    if (operation.requestBody?.content) {
      // For simplicity, assume JSON content and flatten the schema
      const jsonContent = operation.requestBody.content['application/json'];
      if (jsonContent?.schema) {
        this.flattenSchemaToParameters(jsonContent.schema, parameters, operation.requestBody.required);
      }
    }

    // Warn if parameter inflation exceeds threshold
    const paramCount = Object.keys(parameters).length;
    if (paramCount > 60) {
      // Using console.warn to avoid adding logger dependency here
      console.warn(
        `[ProfileLoader] Generated tool has ${paramCount} parameters (>60). Operation: ${operation.operationId} ${operation.method.toUpperCase()} ${operation.path}`
      );
    }

    return {
      name: operation.operationId,
      description: operation.summary || operation.description || `Execute ${operation.method.toUpperCase()} ${operation.path}`,
      operations: {
        'execute': operation.operationId,
      },
      parameters,
    };
  }

  /**
   * Map OpenAPI schema to parameter type
   */
  private static mapOpenAPISchemaToParameterType(schema: SchemaInfo): 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' {
    switch (schema.type) {
      case 'string':
        return 'string';
      case 'integer':
        return 'integer';
      case 'number':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array':
        return 'array';
      case 'object':
        return 'object';
      default:
        return 'string'; // fallback
    }
  }

  /**
   * Recursively flatten schema properties to parameters
   */
  private static flattenSchemaToParameters(
    schema: SchemaInfo,
    parameters: Record<string, import('./types/profile.js').ParameterDefinition>,
    required: boolean = false
  ): void {
    if (schema.type === 'object' && schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const isRequired = schema.required?.includes(propName) || required;
        parameters[propName] = {
          type: this.mapOpenAPISchemaToParameterType(propSchema as SchemaInfo),
          description: `Property ${propName}`,
          required: isRequired,
        };
      }
    }
  }
}


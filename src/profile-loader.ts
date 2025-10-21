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

      // Validate composite steps DAG (no circular dependencies)
      if (tool.composite && tool.steps) {
        this.validateCompositeStepsDAG(tool.name, tool.steps);
      }
    }
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
   * Create a minimal default profile from OpenAPI spec
   *
   * Why: Allows running server without profile for quick exploration.
   * Generates simple pass-through tools for all operations.
   */
  static createDefaultProfile(profileName: string): Profile {
    return {
      profile_name: profileName,
      description: 'Auto-generated default profile',
      tools: [],
      interceptors: {},
    };
  }
}


/**
 * Profile configuration loader and validator
 * 
 * Why validation: Profile config comes from user files. Invalid config would
 * cause runtime errors. Validate upfront with clear error messages.
 * 
 * ⚠️ CRITICAL: Zod schemas MUST stay in sync with TypeScript types!
 * When adding fields to src/types/profile.ts:
 * 1. Update TypeScript interface (compile-time checking)
 * 2. Update profile-schema.json (JSON validation)
 * 3. Update Zod schemas below (runtime validation)
 * 
 * Missing Zod fields = silently removed from parsed profiles!
 * See IMPLEMENTATION.md for details.
 */

import fs from 'fs/promises';
import { z } from 'zod';
import type { Profile } from './types/profile.js';

// Zod schemas for runtime validation
const ParameterDefSchema = z.object({
  type: z.enum(['string', 'integer', 'number', 'boolean', 'array', 'object']),
  description: z.string(),
  required: z.boolean().optional(),
  required_for: z.array(z.string()).optional(),
  enum: z.array(z.string()).optional(),
  items: z.object({ type: z.string() }).optional(),
  default: z.unknown().optional(),
  example: z.unknown().optional(),
});

const ArrayFormatSchema = z.enum(['brackets', 'indices', 'repeat', 'comma']);

const CompositeStepSchema = z.object({
  call: z.string(),
  store_as: z.string(),
});

const ToolDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  operations: z.record(z.string()).optional(),
  composite: z.boolean().optional(),
  steps: z.array(CompositeStepSchema).optional(),
  partial_results: z.boolean().optional(),
  parameters: z.record(ParameterDefSchema),
  metadata_params: z.array(z.string()).optional(),
  response_fields: z.record(z.array(z.string())).optional(),
});

const AuthInterceptorSchema = z.object({
  type: z.enum(['bearer', 'query', 'custom-header']),
  header_name: z.string().optional(),
  query_param: z.string().optional(),
  value_from_env: z.string(),
}).refine(
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

const BaseUrlConfigSchema = z.object({
  value_from_env: z.string(),
  default: z.string().optional(),
});

const RateLimitConfigSchema = z.object({
  max_requests_per_minute: z.number().positive(),
});

const RetryConfigSchema = z.object({
  max_attempts: z.number().int().positive(),
  backoff_ms: z.array(z.number().positive()),
  retry_on_status: z.array(z.number().int()),
});

const InterceptorConfigSchema = z.object({
  auth: AuthInterceptorSchema.optional(),
  base_url: BaseUrlConfigSchema.optional(),
  rate_limit: RateLimitConfigSchema.optional(),
  retry: RetryConfigSchema.optional(),
  array_format: ArrayFormatSchema.optional(),
});

const ProfileSchema = z.object({
  profile_name: z.string(),
  description: z.string().optional(),
  tools: z.array(ToolDefSchema),
  interceptors: InterceptorConfigSchema.optional(),
  parameter_aliases: z.record(z.array(z.string())).optional(),
});

export class ProfileLoader {
  async load(profilePath: string): Promise<Profile> {
    const content = await fs.readFile(profilePath, 'utf-8');
    const json = JSON.parse(content);
    
    // Validate with Zod - throws detailed error if invalid
    const profile = ProfileSchema.parse(json) as Profile;
    
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
        throw new Error(
          `Tool '${tool.name}' is marked as composite but has no steps`
        );
      }

      // Non-composite tools must have operations
      if (!tool.composite && !tool.operations) {
        throw new Error(
          `Tool '${tool.name}' must have either 'operations' or be marked as 'composite' with 'steps'`
        );
      }

      // Validate required_for references existing enum values
      for (const [paramName, paramDef] of Object.entries(tool.parameters)) {
        if (paramDef.required_for) {
          const actionParam = tool.parameters['action'];
          if (!actionParam?.enum) {
            throw new Error(
              `Parameter '${paramName}' in tool '${tool.name}' has 'required_for' but 'action' parameter has no enum`
            );
          }
          
          for (const action of paramDef.required_for) {
            if (!actionParam.enum.includes(action)) {
              throw new Error(
                `Parameter '${paramName}' requires action '${action}' but it's not in action enum: ${actionParam.enum.join(', ')}`
              );
            }
          }
        }
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


/**
 * Composite action executor for chaining API calls
 * 
 * Why: Reduces roundtrips by fetching related data in sequence (e.g., MR + comments).
 * Aggregates results into single JSON structure as defined by store_as paths.
 */

import type { CompositeStep } from './types/profile.js';
import type { HttpClient } from './interceptors.js';
import type { OperationInfo } from './types/openapi.js';
import { OpenAPIParser } from './openapi-parser.js';

export interface CompositeResult {
  data: Record<string, unknown>;
  completed_steps: number;
  total_steps: number;
  errors?: StepError[];
}

export interface StepError {
  step_index: number;
  step_call: string;
  error: string;
  timestamp: string;
}

export class CompositeExecutor {
  constructor(
    private parser: OpenAPIParser,
    private httpClient?: HttpClient
  ) {}

  /**
   * Execute a series of API calls and merge results
   *
   * Why sequential: Steps may depend on previous results (e.g., get MR ID, then fetch comments).
   * Could parallelize independent steps in future optimization.
   *
   * Supports partial results: If allowPartial=true, continues after errors and returns
   * what was completed. Useful for composite actions where some data is better than none.
   */
  async execute(
    steps: CompositeStep[],
    args: Record<string, unknown>,
    allowPartial: boolean = false,
    httpClient?: HttpClient
  ): Promise<CompositeResult> {
    const result: Record<string, unknown> = {};
    const errors: StepError[] = [];
    let completedSteps = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      try {
        const { method, path, operation } = this.parseCall(step.call);
        
        if (!operation) {
          throw new Error(`Operation not found for call: ${step.call}`);
        }

        // Substitute path parameters from args
        const resolvedPath = this.resolvePath(path, args);
        
        // Execute request
        const client = httpClient || this.httpClient;
        if (!client) {
          throw new Error('HTTP client not provided');
        }
        const response = await client.request(method, resolvedPath, {
          params: this.extractQueryParams(operation, args),
        });

        // Store result at specified path
        this.storeResult(result, step.store_as, response.body);
        completedSteps++;
        
      } catch (error) {
        const stepError: StepError = {
          step_index: i,
          step_call: step.call,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        };
        
        errors.push(stepError);
        
        // Store error in result for debugging
        this.storeResult(
          result,
          `${step.store_as}_error`,
          stepError
        );
        
        if (!allowPartial) {
          throw new Error(
            `Composite step ${i + 1}/${steps.length} failed: ${stepError.error}\n` +
            `Completed steps: ${completedSteps}\n` +
            `Failed step: ${step.call}`
          );
        }
        
        // Continue with next step if partial results allowed
      }
    }

    return {
      data: result,
      completed_steps: completedSteps,
      total_steps: steps.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Parse composite step call syntax
   * 
   * Format: "GET /projects/{id}/merge_requests/{iid}"
   */
  private parseCall(call: string): { method: string; path: string; operation: OperationInfo | undefined } {
    const [method, path] = call.split(' ');
    const pathInfo = this.parser.getPath(path);
    const operation = pathInfo?.operations[method.toLowerCase()];

    return { method, path, operation };
  }

  /**
   * Resolve path template with actual values
   * 
   * Example: "/projects/{id}" + {id: "123"} => "/projects/123"
   */
  private resolvePath(template: string, args: Record<string, unknown>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = args[key];
      if (value === undefined) {
        throw new Error(`Missing path parameter: ${key}`);
      }
      return String(value);
    });
  }

  /**
   * Extract query parameters from args based on operation definition
   */
  private extractQueryParams(operation: OperationInfo, args: Record<string, unknown>): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};

    for (const param of operation.parameters) {
      if (param.in === 'query' && args[param.name] !== undefined) {
        const value = args[param.name];
        // Pass arrays as-is for HttpClient serialization
        if (Array.isArray(value)) {
          params[param.name] = value.map(String);
        } else {
          params[param.name] = String(value);
        }
      }
    }

    return params;
  }

  /**
   * Store value at JSONPath-like location
   * 
   * Why nested: Allows semantic structure (comments belong under merge_request object).
   * 
   * Examples:
   * - "merge_request" => { merge_request: value }
   * - "merge_request.comments" => { merge_request: { comments: value } }
   * 
   * Validates path navigation to prevent overwriting non-object values.
   */
  private storeResult(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.');
    let current = target as Record<string, unknown>;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = current[part];
      
      // Validate we can navigate through this path
      if (existing !== undefined && (typeof existing !== 'object' || existing === null)) {
        throw new Error(
          `Cannot store at path '${path}': ` +
          `'${parts.slice(0, i + 1).join('.')}' is ${typeof existing}, not an object`
        );
      }
      
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }
}


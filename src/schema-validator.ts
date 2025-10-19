/**
 * Request body schema validator
 * 
 * Why: Catch invalid requests before sending to API. Better error messages for users.
 * Validates against OpenAPI schema definitions.
 */

import type { SchemaInfo, OperationInfo } from './types/openapi.js';

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
  schema: SchemaInfo;
  value: unknown;
}

export class SchemaValidator {
  /**
   * Validate request body against OpenAPI schema
   * 
   * Why: Prevents sending malformed requests. OpenAPI schema is the source of truth.
   */
  validateRequestBody(
    operation: OperationInfo,
    body: Record<string, unknown>
  ): ValidationResult {
    if (!operation.requestBody?.content['application/json']?.schema) {
      return { valid: true };
    }

    const schema = operation.requestBody.content['application/json'].schema;
    const errors: ValidationError[] = [];

    this.validateAgainstSchema(body, schema, '', errors);

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Recursively validate data against schema
   */
  private validateAgainstSchema(
    data: unknown,
    schema: SchemaInfo,
    path: string,
    errors: ValidationError[]
  ): void {
    // Null/undefined handling
    if (data === null || data === undefined) {
      if (schema.type && schema.type !== 'null') {
        errors.push({
          path: path || '(root)',
          message: `Expected ${schema.type}, got ${data}`,
          schema,
          value: data,
        });
      }
      return;
    }

    // Type validation
    if (schema.type) {
      const actualType = Array.isArray(data) ? 'array' : typeof data;
      if (actualType !== schema.type) {
        errors.push({
          path: path || '(root)',
          message: `Expected ${schema.type}, got ${actualType}`,
          schema,
          value: data,
        });
        return; // Stop validation if type is wrong
      }
    }

    // Enum validation
    // Note: Using 'as any' here is safe - we're checking if value exists in enum array
    // TypeScript doesn't know the enum values at compile time
    if (schema.enum && !schema.enum.includes(data as any)) {
      errors.push({
        path: path || '(root)',
        message: `Value must be one of: ${schema.enum.join(', ')}`,
        schema,
        value: data,
      });
    }

    // Object properties validation
    if (schema.type === 'object' && schema.properties) {
      const obj = data as Record<string, unknown>;
      
      // Check required properties
      for (const required of schema.required || []) {
        if (obj[required] === undefined) {
          errors.push({
            path: path ? `${path}.${required}` : required,
            message: 'Required property is missing',
            schema,
            value: undefined,
          });
        }
      }

      // Validate each property
      for (const [key, value] of Object.entries(obj)) {
        if (schema.properties[key]) {
          this.validateAgainstSchema(
            value,
            schema.properties[key],
            path ? `${path}.${key}` : key,
            errors
          );
        }
        // Note: Not validating additionalProperties (too strict for most APIs)
      }
    }

    // Array items validation
    if (schema.type === 'array' && schema.items && Array.isArray(data)) {
      data.forEach((item, index) => {
        this.validateAgainstSchema(
          item,
          schema.items!,
          `${path}[${index}]`,
          errors
        );
      });
    }

    // String format validation (basic)
    if (schema.type === 'string' && schema.format && typeof data === 'string') {
      if (schema.format === 'email' && !this.isEmail(data)) {
        errors.push({
          path: path || '(root)',
          message: 'Invalid email format',
          schema,
          value: data,
        });
      }
      if (schema.format === 'uri' && !this.isUri(data)) {
        errors.push({
          path: path || '(root)',
          message: 'Invalid URI format',
          schema,
          value: data,
        });
      }
    }
  }

  private isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  private isUri(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
}


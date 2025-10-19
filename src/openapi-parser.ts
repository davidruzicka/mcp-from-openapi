/**
 * OpenAPI specification parser and indexer
 * 
 * Why indexing: Large OpenAPI specs (GitLab has ~200 operations) need fast lookup.
 * Pre-indexing by operationId and path avoids linear search on every tool call.
 */

import fs from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type { OpenAPIV3 } from 'openapi-types';
import type { OpenAPIIndex, OperationInfo, ParameterInfo, PathInfo, RequestBodyInfo, SchemaInfo } from './types/openapi.js';

export class OpenAPIParser {
  private spec?: OpenAPIV3.Document;
  private index?: OpenAPIIndex;

  async load(specPath: string): Promise<void> {
    const content = await fs.readFile(specPath, 'utf-8');
    
    // Parse YAML or JSON based on extension
    if (specPath.endsWith('.yaml') || specPath.endsWith('.yml')) {
      this.spec = parseYaml(content) as OpenAPIV3.Document;
    } else {
      this.spec = JSON.parse(content) as OpenAPIV3.Document;
    }

    this.buildIndex();
  }

  /**
   * Build search index from OpenAPI spec
   * 
   * Why upfront: Trading startup time for runtime performance. Index creation
   * happens once; lookups happen on every tool call.
   */
  private buildIndex(): void {
    if (!this.spec) throw new Error('Spec not loaded');

    const operations = new Map<string, OperationInfo>();
    const paths = new Map<string, PathInfo>();

    for (const [path, pathItem] of Object.entries(this.spec.paths || {})) {
      if (!pathItem) continue;

      const pathOperations: Record<string, OperationInfo> = {};

      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
        const operation = pathItem[method] as OpenAPIV3.OperationObject | undefined;
        if (!operation) continue;

        const operationInfo = this.extractOperationInfo(path, method, operation);
        
        if (operationInfo.operationId) {
          operations.set(operationInfo.operationId, operationInfo);
        }
        
        pathOperations[method] = operationInfo;
      }

      paths.set(path, { path, operations: pathOperations });
    }

    this.index = {
      spec: this.spec,
      operations,
      paths,
    };
  }

  private extractOperationInfo(
    path: string,
    method: string,
    operation: OpenAPIV3.OperationObject
  ): OperationInfo {
    return {
      operationId: operation.operationId || `${method}_${path}`,
      method: method.toUpperCase(),
      path,
      summary: operation.summary,
      description: operation.description,
      parameters: this.extractParameters(operation),
      requestBody: this.extractRequestBody(operation),
      tags: operation.tags,
    };
  }

  private extractParameters(operation: OpenAPIV3.OperationObject): ParameterInfo[] {
    if (!operation.parameters) return [];

    return operation.parameters
      .map(p => {
        // Resolve $ref to parameter definition
        if ('$ref' in p) {
          return this.resolveParameter(p.$ref);
        }
        return p;
      })
      .filter((p): p is OpenAPIV3.ParameterObject => p !== null)
      .map(param => ({
        name: param.name,
        in: param.in as 'path' | 'query' | 'header' | 'cookie',
        required: param.required ?? false,
        schema: this.extractSchema(param.schema),
        description: param.description,
      }));
  }

  /**
   * Resolve $ref to parameter definition
   * 
   * Why: GitLab spec uses shared parameter definitions (e.g., ProjectIdOrPath).
   * Need to resolve these refs to get actual parameter details.
   */
  private resolveParameter(ref: string): OpenAPIV3.ParameterObject | null {
    if (!this.spec) return null;
    
    // Extract ref path: #/components/parameters/ProjectIdOrPath => ProjectIdOrPath
    const refName = ref.split('/').pop();
    if (!refName) return null;

    const param = this.spec.components?.parameters?.[refName];
    if (!param || '$ref' in param) return null;

    return param as OpenAPIV3.ParameterObject;
  }

  private extractRequestBody(operation: OpenAPIV3.OperationObject): RequestBodyInfo | undefined {
    if (!operation.requestBody || '$ref' in operation.requestBody) return undefined;

    const body = operation.requestBody;
    const content: Record<string, { schema: SchemaInfo }> = {};

    for (const [mediaType, mediaTypeObj] of Object.entries(body.content || {})) {
      if (mediaTypeObj.schema) {
        content[mediaType] = {
          schema: this.extractSchema(mediaTypeObj.schema),
        };
      }
    }

    return {
      required: body.required ?? false,
      content,
    };
  }

  private extractSchema(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined): SchemaInfo {
    if (!schema) return {};
    if ('$ref' in schema) return { type: 'object' }; // Simplified: don't resolve refs

    const result: SchemaInfo = {
      type: schema.type as string | undefined,
      format: schema.format,
      enum: schema.enum,
      default: schema.default,
    };

    if (schema.type === 'array' && schema.items && !('$ref' in schema.items)) {
      result.items = this.extractSchema(schema.items);
    }

    if (schema.type === 'object' && schema.properties) {
      result.properties = {};
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        result.properties[key] = this.extractSchema(propSchema);
      }
      result.required = schema.required;
    }

    return result;
  }

  getOperation(operationId: string): OperationInfo | undefined {
    return this.index?.operations.get(operationId);
  }

  getPath(path: string): PathInfo | undefined {
    return this.index?.paths.get(path);
  }

  getBaseUrl(): string {
    const servers = this.spec?.servers;
    return servers?.[0]?.url || '';
  }

  getAllOperations(): OperationInfo[] {
    return Array.from(this.index?.operations.values() || []);
  }
}


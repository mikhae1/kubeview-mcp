import type { MCPBridge } from '../bridge/MCPBridge.js';
import type { NormalizedSchema, ToolSchemaSummary, NormalizedObjectProperty } from './types.js';

type JsonSchema = {
  type?: string | string[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  enum?: unknown[];
  required?: string[];
  description?: string;
  additionalProperties?: boolean | JsonSchema;
};

export class ToolSchemaIntrospector {
  constructor(private readonly bridge: MCPBridge) {}

  public collectToolSchemas(): ToolSchemaSummary[] {
    return this.bridge.getRegisteredTools().map((registration) => ({
      qualifiedName: registration.qualifiedName,
      server: registration.server,
      toolName: registration.toolName,
      description: registration.tool.description,
      inputSchema: this.normalizeSchema(registration.tool.inputSchema as JsonSchema),
    }));
  }

  private normalizeSchema(schema: JsonSchema | undefined): NormalizedSchema | undefined {
    if (!schema) {
      return undefined;
    }

    const schemaType = schema.type;

    if (Array.isArray(schemaType)) {
      // Prefer the first concrete type
      const firstType = schemaType.find((type) => type !== 'null') ?? schemaType[0];
      return this.normalizeSchema({ ...schema, type: firstType });
    }

    if ('enum' in schema && Array.isArray(schema.enum)) {
      return {
        kind: 'enum',
        values: schema.enum.filter((value): value is string => typeof value === 'string'),
      };
    }

    switch (schemaType) {
      case 'string':
        return { kind: 'string' };
      case 'number':
        return { kind: 'number' };
      case 'integer':
        return { kind: 'integer' };
      case 'boolean':
        return { kind: 'boolean' };
      case 'array':
        return {
          kind: 'array',
          items: this.normalizeSchema(schema.items as JsonSchema) ?? { kind: 'unknown' },
        };
      case 'object':
        return this.normalizeObjectSchema(schema);
      default:
        if ('properties' in schema || 'required' in schema) {
          return this.normalizeObjectSchema(schema);
        }
        return { kind: 'unknown' };
    }
  }

  private normalizeObjectSchema(schema: JsonSchema): NormalizedSchema {
    const requiredFields = new Set(
      Array.isArray(schema.required) ? (schema.required as string[]) : [],
    );

    const properties: NormalizedObjectProperty[] = Object.entries(schema.properties ?? {}).map(
      ([name, subschema]) => {
        const typedSubschema = subschema as JsonSchema;
        return {
          name,
          required: requiredFields.has(name),
          schema: this.normalizeSchema(typedSubschema) ?? { kind: 'unknown' },
          description:
            typeof typedSubschema.description === 'string' ? typedSubschema.description : undefined,
        };
      },
    );

    return {
      kind: 'object',
      properties,
      additionalProperties: Boolean(schema.additionalProperties),
    };
  }
}

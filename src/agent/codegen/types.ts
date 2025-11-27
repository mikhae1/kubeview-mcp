export type NormalizedScalarKind = 'string' | 'number' | 'integer' | 'boolean' | 'unknown';

export interface NormalizedEnumType {
  kind: 'enum';
  values: string[];
}

export interface NormalizedArrayType {
  kind: 'array';
  items: NormalizedSchema;
}

export interface NormalizedObjectProperty {
  name: string;
  required: boolean;
  schema: NormalizedSchema;
  description?: string;
}

export interface NormalizedObjectType {
  kind: 'object';
  properties: NormalizedObjectProperty[];
  additionalProperties?: boolean;
}

export type NormalizedSchema =
  | { kind: NormalizedScalarKind }
  | NormalizedEnumType
  | NormalizedArrayType
  | NormalizedObjectType;

export interface ToolSchemaSummary {
  qualifiedName: string;
  server: string;
  toolName: string;
  description?: string;
  inputSchema?: NormalizedSchema;
}

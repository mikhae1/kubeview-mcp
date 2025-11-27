import type {
  ToolSchemaSummary,
  NormalizedSchema,
  NormalizedObjectType,
  NormalizedEnumType,
  NormalizedArrayType,
} from './types.js';

export interface ToolSignature {
  name: string;
  camelName: string;
  signature: string;
  shortDescription: string;
  hiddenParamCount: number;
}

export interface ParameterDoc {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
}

export interface Example {
  description: string;
  code: string;
}

export interface ToolDetailedHelp {
  name: string;
  camelName: string;
  description: string;
  parameters: ParameterDoc[];
  examples: Example[];
}

/**
 * Generates tool descriptions with progressive disclosure for LLM agents.
 * Layer 1: Overview tree - compact tool listing
 * Layer 2: Signatures - typed function signatures
 * Layer 3: On-demand help via getToolHelp()
 */
export class ToolDescriptionBuilder {
  private readonly maxSignatureParams: number;

  constructor(options?: { maxSignatureParams?: number }) {
    this.maxSignatureParams = options?.maxSignatureParams ?? 4;
  }

  /**
   * Layer 1: Compact tree overview of all tools
   */
  buildOverviewTree(tools: ToolSchemaSummary[]): string {
    const grouped = this.groupByServer(tools);
    const lines: string[] = [];

    for (const [server, serverTools] of grouped) {
      lines.push(`/${server}/`);
      for (let i = 0; i < serverTools.length; i++) {
        const tool = serverTools[i];
        const prefix = i === serverTools.length - 1 ? '└── ' : '├── ';
        const fn = this.toCamelCase(tool.toolName);
        const shortDesc = this.truncate(tool.description, 50);
        lines.push(`  ${prefix}${fn}()${shortDesc ? ' - ' + shortDesc : ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Layer 2: Generate compact signatures for specified tools
   */
  buildSignatures(tools: ToolSchemaSummary[]): ToolSignature[] {
    return tools.map((tool) => this.buildToolSignature(tool));
  }

  /**
   * Layer 2: Format signatures as readable string block
   */
  formatSignaturesBlock(tools: ToolSchemaSummary[], indent = '  '): string {
    const signatures = this.buildSignatures(tools);
    return signatures.map((s) => `${indent}${s.signature}`).join('\n');
  }

  /**
   * Layer 3: Full documentation for a tool (used by getToolHelp runtime)
   */
  buildDetailedHelp(tool: ToolSchemaSummary): ToolDetailedHelp {
    const params = this.extractParameters(tool.inputSchema);
    return {
      name: tool.toolName,
      camelName: this.toCamelCase(tool.toolName),
      description: tool.description ?? '',
      parameters: params,
      examples: this.generateExamples(tool),
    };
  }

  /**
   * Build all help data for runtime injection
   */
  buildAllHelpData(tools: ToolSchemaSummary[]): ToolDetailedHelp[] {
    return tools.map((t) => this.buildDetailedHelp(t));
  }

  private buildToolSignature(tool: ToolSchemaSummary): ToolSignature {
    const params = this.extractParameters(tool.inputSchema);
    const visibleParams = params.slice(0, this.maxSignatureParams);
    const hiddenCount = Math.max(0, params.length - this.maxSignatureParams);

    const paramParts = visibleParams.map(
      (p) => `${p.name}${p.required ? '' : '?'}: ${this.compactType(p)}`,
    );

    let paramStr = paramParts.join(', ');
    if (hiddenCount > 0) {
      paramStr += `, ...`; // indicate more params
    }

    const fn = this.toCamelCase(tool.toolName);
    const signature = params.length > 0 ? `${fn}({ ${paramStr} })` : `${fn}()`;

    return {
      name: tool.toolName,
      camelName: fn,
      signature: hiddenCount > 0 ? `${signature} // +${hiddenCount} params` : signature,
      shortDescription: this.truncate(tool.description, 60),
      hiddenParamCount: hiddenCount,
    };
  }

  private extractParameters(schema?: NormalizedSchema): ParameterDoc[] {
    if (!schema || schema.kind !== 'object') return [];
    const objSchema = schema as NormalizedObjectType;

    return objSchema.properties.map((prop) => ({
      name: prop.name,
      type: this.schemaToTypeString(prop.schema),
      required: prop.required,
      description: prop.description,
      enumValues:
        prop.schema.kind === 'enum' ? (prop.schema as NormalizedEnumType).values : undefined,
    }));
  }

  private compactType(param: ParameterDoc): string {
    if (param.enumValues) {
      if (param.enumValues.length <= 3) {
        return param.enumValues.map((v) => `'${v}'`).join(' | ');
      }
      return `'${param.enumValues[0]}' | '${param.enumValues[1]}' | ...`;
    }
    return param.type;
  }

  private schemaToTypeString(schema: NormalizedSchema): string {
    switch (schema.kind) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'array': {
        const arrSchema = schema as NormalizedArrayType;
        return `${this.schemaToTypeString(arrSchema.items)}[]`;
      }
      case 'enum': {
        const enumSchema = schema as NormalizedEnumType;
        return enumSchema.values.length <= 3
          ? enumSchema.values.map((v) => `'${v}'`).join(' | ')
          : 'string';
      }
      case 'object':
        return 'object';
      default:
        return 'any';
    }
  }

  private generateExamples(tool: ToolSchemaSummary): Example[] {
    const examples: Example[] = [];
    const fn = this.toCamelCase(tool.toolName);
    const params = this.extractParameters(tool.inputSchema);
    const paramNames = new Set(params.map((p) => p.name));

    // Generate contextual examples based on tool patterns
    if (tool.toolName.includes('list')) {
      examples.push({ description: 'List all', code: `await ${fn}({})` });
      if (paramNames.has('namespace')) {
        examples.push({
          description: 'Filter by namespace',
          code: `await ${fn}({ namespace: 'default' })`,
        });
      }
      if (paramNames.has('allNamespaces')) {
        examples.push({
          description: 'All namespaces',
          code: `await ${fn}({ allNamespaces: true })`,
        });
      }
    } else if (tool.toolName.includes('get')) {
      const nameParam = paramNames.has('name')
        ? 'name'
        : paramNames.has('podName')
          ? 'podName'
          : 'kind';
      examples.push({
        description: 'Get resource',
        code: `await ${fn}({ ${nameParam}: 'my-resource' })`,
      });
    } else if (tool.toolName.includes('log')) {
      examples.push({
        description: 'Tail logs',
        code: `await ${fn}({ podName: 'my-pod', tailLines: 100 })`,
      });
    } else if (tool.toolName.includes('exec')) {
      examples.push({
        description: 'Execute command',
        code: `await ${fn}({ podName: 'my-pod', namespace: 'default', command: ['ls', '-la'] })`,
      });
    } else if (tool.toolName.includes('metrics')) {
      examples.push({
        description: 'Get metrics',
        code: `await ${fn}({})`,
      });
    }

    // Fallback
    if (examples.length === 0) {
      examples.push({ description: 'Basic usage', code: `await ${fn}({})` });
    }

    return examples;
  }

  private groupByServer(tools: ToolSchemaSummary[]): Map<string, ToolSchemaSummary[]> {
    const grouped = new Map<string, ToolSchemaSummary[]>();
    for (const tool of tools) {
      if (!grouped.has(tool.server)) grouped.set(tool.server, []);
      grouped.get(tool.server)!.push(tool);
    }
    return grouped;
  }

  private truncate(text?: string, maxLen = 50): string {
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
  }

  private toCamelCase(name: string): string {
    return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }
}

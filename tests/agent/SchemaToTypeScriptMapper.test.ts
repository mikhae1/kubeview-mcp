import ts from 'typescript';
import { SchemaToTypeScriptMapper } from '../../src/agent/codegen/SchemaToTypeScriptMapper.js';
import type { NormalizedSchema } from '../../src/agent/codegen/types.js';

function printNode(node: ts.Node): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const source = ts.createSourceFile(
    'test.ts',
    '',
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.TS,
  );
  return printer.printNode(ts.EmitHint.Unspecified, node, source);
}

describe('SchemaToTypeScriptMapper', () => {
  const mapper = new SchemaToTypeScriptMapper();

  it('renders union types for enums', () => {
    const schema: NormalizedSchema = { kind: 'enum', values: ['pending', 'ready'] };
    const node = mapper.typeNodeFromSchema(schema);
    expect(printNode(node)).toBe('"pending" | "ready"');
  });

  it('renders object literals with optional properties', () => {
    const schema: NormalizedSchema = {
      kind: 'object',
      properties: [
        { name: 'id', required: true, schema: { kind: 'string' } },
        { name: 'description', required: false, schema: { kind: 'string' } },
      ],
    };
    const node = mapper.typeNodeFromSchema(schema);
    expect(printNode(node)).toBe('{\n    id: string;\n    description?: string;\n}');
  });
});

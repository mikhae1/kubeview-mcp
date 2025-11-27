import { ToolDescriptionBuilder } from '../../src/agent/codegen/ToolDescriptionBuilder.js';
import type { ToolSchemaSummary, NormalizedObjectType } from '../../src/agent/codegen/types.js';

describe('ToolDescriptionBuilder', () => {
  const builder = new ToolDescriptionBuilder();

  const mockTools: ToolSchemaSummary[] = [
    {
      qualifiedName: 'test-server__list_items',
      server: 'test-server',
      toolName: 'list_items',
      description: 'List all items in the system with filtering options',
      inputSchema: {
        kind: 'object',
        properties: [
          {
            name: 'namespace',
            required: false,
            schema: { kind: 'string' },
            description: 'Namespace to filter',
          },
          { name: 'limit', required: false, schema: { kind: 'integer' }, description: 'Max items' },
          {
            name: 'status',
            required: false,
            schema: { kind: 'enum', values: ['active', 'pending', 'done'] },
          },
        ],
      } as NormalizedObjectType,
    },
    {
      qualifiedName: 'test-server__get_item',
      server: 'test-server',
      toolName: 'get_item',
      description: 'Get a specific item by name',
      inputSchema: {
        kind: 'object',
        properties: [
          { name: 'name', required: true, schema: { kind: 'string' }, description: 'Item name' },
          { name: 'namespace', required: false, schema: { kind: 'string' } },
        ],
      } as NormalizedObjectType,
    },
  ];

  describe('buildOverviewTree', () => {
    it('generates tree structure grouped by server', () => {
      const tree = builder.buildOverviewTree(mockTools);
      expect(tree).toContain('/test-server/');
      expect(tree).toContain('listItems()');
      expect(tree).toContain('getItem()');
      expect(tree).toContain('├──');
      expect(tree).toContain('└──');
    });

    it('includes truncated descriptions', () => {
      const tree = builder.buildOverviewTree(mockTools);
      expect(tree).toContain('List all items');
    });
  });

  describe('buildSignatures', () => {
    it('generates typed signatures', () => {
      const signatures = builder.buildSignatures(mockTools);
      expect(signatures).toHaveLength(2);

      const listSig = signatures.find((s) => s.name === 'list_items');
      expect(listSig?.camelName).toBe('listItems');
      expect(listSig?.signature).toContain('namespace?');
      expect(listSig?.signature).toContain('string');
    });

    it('shows enum values in signature', () => {
      const signatures = builder.buildSignatures(mockTools);
      const listSig = signatures.find((s) => s.name === 'list_items');
      expect(listSig?.signature).toMatch(/'active'|'pending'|'done'/);
    });

    it('marks required params without ?', () => {
      const signatures = builder.buildSignatures(mockTools);
      const getSig = signatures.find((s) => s.name === 'get_item');
      expect(getSig?.signature).toContain('name:'); // no ? for required
      expect(getSig?.signature).toContain('namespace?:'); // ? for optional
    });
  });

  describe('buildDetailedHelp', () => {
    it('includes all parameters with docs', () => {
      const help = builder.buildDetailedHelp(mockTools[0]);
      expect(help.name).toBe('list_items');
      expect(help.camelName).toBe('listItems');
      expect(help.parameters).toHaveLength(3);

      const nsParam = help.parameters.find((p) => p.name === 'namespace');
      expect(nsParam?.type).toBe('string');
      expect(nsParam?.required).toBe(false);
      expect(nsParam?.description).toBe('Namespace to filter');
    });

    it('includes enum values in parameter docs', () => {
      const help = builder.buildDetailedHelp(mockTools[0]);
      const statusParam = help.parameters.find((p) => p.name === 'status');
      expect(statusParam?.enumValues).toEqual(['active', 'pending', 'done']);
    });

    it('generates contextual examples', () => {
      const help = builder.buildDetailedHelp(mockTools[0]);
      expect(help.examples.length).toBeGreaterThan(0);
      expect(help.examples.some((e) => e.code.includes('listItems'))).toBe(true);
    });
  });

  describe('formatSignaturesBlock', () => {
    it('formats with custom indent', () => {
      const block = builder.formatSignaturesBlock(mockTools, '    ');
      expect(block).toMatch(/^ {4}listItems/m);
    });
  });

  describe('buildAllHelpData', () => {
    it('builds help for all tools', () => {
      const allHelp = builder.buildAllHelpData(mockTools);
      expect(allHelp).toHaveLength(2);
      expect(allHelp.map((h) => h.name)).toEqual(['list_items', 'get_item']);
    });
  });

  describe('edge cases', () => {
    it('handles tools without inputSchema', () => {
      const toolWithoutSchema: ToolSchemaSummary = {
        qualifiedName: 'test__no_schema',
        server: 'test',
        toolName: 'no_schema',
        description: 'Tool without schema',
      };

      const sig = builder.buildSignatures([toolWithoutSchema])[0];
      expect(sig.signature).toBe('noSchema()');

      const help = builder.buildDetailedHelp(toolWithoutSchema);
      expect(help.parameters).toEqual([]);
    });

    it('handles empty tool list', () => {
      const tree = builder.buildOverviewTree([]);
      expect(tree).toBe('');
    });

    it('truncates long descriptions', () => {
      const longDescTool: ToolSchemaSummary = {
        qualifiedName: 'test__long',
        server: 'test',
        toolName: 'long_desc',
        description: 'A'.repeat(200),
      };

      const tree = builder.buildOverviewTree([longDescTool]);
      expect(tree.length).toBeLessThan(200);
      expect(tree).toContain('...');
    });
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { RunCodeTool } from '../../src/tools/RunCodeTool.js';

describe('RunCodeTool', () => {
  it('executes code and returns values', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');
    const response = await tool.execute({
      code: `
        console.log({ status: 'ok' });
        return { hello: 'code-mode' };
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    expect(payload.result).toEqual({ hello: 'code-mode' });
    // stdout is only included when success is false or result is empty (per implementation)
    expect(payload.stdout).toBeUndefined();
  });

  it('reports errors when code fails', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');
    const response = await tool.execute({
      code: 'throw new Error("test error")',
    });

    const payload = response as any;
    expect(payload.success).toBe(false);
    expect(payload.error.message).toContain('test error');
  });

  it('generates tool helpers from manifest', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'run-code-tool-'));
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify(
        [
          {
            server: 'demo-server',
            tools: [
              {
                name: 'foo_bar',
                qualifiedName: 'demo-server__foo_bar',
                description: 'Foo does things',
              },
            ],
          },
        ],
        null,
        2,
      ),
    );

    const tool = new RunCodeTool(undefined, manifestPath);
    // Description highlights returning data with items property
    expect(tool.tool.description).toContain('pods.items');

    // Check that the helper function exists in generated code
    const response = await tool.execute({ code: 'return typeof tools.other.fooBar;' });
    expect((response as any).result).toBe('function');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes API reference and tool docs in description', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');
    expect(tool.tool.description).toContain('API Reference');
    expect(tool.tool.description).toContain('Key Functions');
    expect(tool.tool.description).toContain('Quick Start');
  });

  it('includes quick start examples in description', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');
    expect(tool.tool.description).toContain('Quick Start');
    expect(tool.tool.description).toContain('tools.kubernetes');
    expect(tool.tool.description).toContain('tools.search');
  });

  it('can call tools when executor is set', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');

    // Mock tool executor - returns standard Kubernetes format
    const mockExecutor = jest.fn().mockResolvedValue({ items: ['pod1', 'pod2'] });
    tool.setToolExecutor(mockExecutor);

    const response = await tool.execute({
      code: `
        const result = await tools.call('test__tool', { arg: 'value' });
        return result;
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    // unwrapResult preserves { items: [...] } format when items already exists
    expect(payload.result).toEqual({ items: ['pod1', 'pod2'] });
    expect(mockExecutor).toHaveBeenCalledWith('test__tool', { arg: 'value' });
  });

  it('provides tools.search helper for discovery', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'run-code-tool-'));
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify([
        {
          server: 'demo-server',
          tools: [
            { name: 'list_pods', qualifiedName: 'demo__list_pods', description: 'List all pods' },
            { name: 'get_logs', qualifiedName: 'demo__get_logs', description: 'Get pod logs' },
          ],
        },
      ]),
    );

    const tool = new RunCodeTool(undefined, manifestPath);
    const response = await tool.execute({
      code: `
        return tools.search('pods');
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    const searchResults = payload.result;
    expect(searchResults.some((r: any) => r.name === 'list_pods')).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('provides tools.help helper for detailed docs', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'run-code-tool-'));
    const manifestPath = path.join(tmpDir, 'manifest.json');
    writeFileSync(
      manifestPath,
      JSON.stringify([
        {
          server: 'demo-server',
          tools: [
            {
              name: 'list_items',
              qualifiedName: 'demo__list_items',
              description: 'List items in namespace',
              inputSchema: {
                kind: 'object',
                properties: [
                  {
                    name: 'namespace',
                    required: false,
                    schema: { kind: 'string' },
                    description: 'Filter by ns',
                  },
                ],
              },
            },
          ],
        },
      ]),
    );

    const tool = new RunCodeTool(undefined, manifestPath);
    const response = await tool.execute({
      code: `
        return tools.help('listItems');
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    const helpData = payload.result;
    expect(helpData.name).toBe('list_items');
    expect(helpData.parameters).toHaveLength(1);
    expect(helpData.parameters[0].name).toBe('namespace');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('unwraps { pods: [...] } format to { items: [...] }', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');

    // Mock tool executor returning { pods: [...] } format (like kube_list)
    const mockExecutor = jest.fn().mockResolvedValue({
      total: 2,
      namespace: 'default',
      pods: [{ name: 'pod1' }, { name: 'pod2' }],
    });
    tool.setToolExecutor(mockExecutor);

    const response = await tool.execute({
      code: `
        const result = await tools.call('kube_list', { namespace: 'default' });
        return result;
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    // unwrapResult should convert { pods: [...] } to { items: [...] }
    expect(payload.result).toEqual({
      items: [{ name: 'pod1' }, { name: 'pod2' }],
    });
  });

  it('wraps arrays returned directly to { items: [...] }', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');

    // Mock tool executor returning array directly (like get_replicasets)
    const mockExecutor = jest.fn().mockResolvedValue([
      { name: 'rs1', replicas: 2 },
      { name: 'rs2', replicas: 3 },
    ]);
    tool.setToolExecutor(mockExecutor);

    const response = await tool.execute({
      code: `
        const result = await tools.call('get_replicasets', { namespace: 'default' });
        return result;
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    // unwrapResult should wrap array to { items: [...] }
    expect(payload.result).toEqual({
      items: [
        { name: 'rs1', replicas: 2 },
        { name: 'rs2', replicas: 3 },
      ],
    });
  });

  it('preserves { items: [...] } format when already present', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');

    // Mock tool executor returning standard Kubernetes format
    const mockExecutor = jest.fn().mockResolvedValue({
      items: [{ name: 'item1' }, { name: 'item2' }],
      metadata: { resourceVersion: '123' },
    });
    tool.setToolExecutor(mockExecutor);

    const response = await tool.execute({
      code: `
        const result = await tools.call('some_tool', {});
        return result;
      `,
    });

    const payload = response as any;
    expect(payload.success).toBe(true);
    // unwrapResult should preserve { items: [...] } format
    expect(payload.result).toEqual({
      items: [{ name: 'item1' }, { name: 'item2' }],
      metadata: { resourceVersion: '123' },
    });
  });
});

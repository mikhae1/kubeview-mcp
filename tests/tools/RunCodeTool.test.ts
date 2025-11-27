import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import os from 'os';
import { RunCodeTool } from '../../src/tools/RunCodeTool.js';

describe('RunCodeTool', () => {
  it('executes code and captures console output', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');
    const response = await tool.execute({
      code: 'console.log("hello code-mode")',
    });

    expect(response.content).toHaveLength(1);
    const payload = JSON.parse(response.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.stdout).toContain('hello code-mode');
  });

  it('reports errors when code fails', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');
    const response = await tool.execute({
      code: 'throw new Error("test error")',
    });

    expect(response.content).toHaveLength(1);
    const payload = JSON.parse(response.content[0].text);
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('test error');
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
    // Check fooBar appears in the API reference under Other category
    expect(tool.tool.description).toContain('fooBar(');

    // Check that the helper function exists in generated code
    const response = await tool.execute({ code: 'console.log(typeof fooBar)' });
    const payload = JSON.parse(response.content[0].text);
    expect(payload.stdout).toContain('function');

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
    expect(tool.tool.description).toContain('kubeList');
    expect(tool.tool.description).toContain('searchTools');
  });

  it('can call tools when executor is set', async () => {
    const tool = new RunCodeTool(undefined, '/path/does/not/exist');

    // Mock tool executor
    const mockExecutor = jest.fn().mockResolvedValue({ items: ['pod1', 'pod2'] });
    tool.setToolExecutor(mockExecutor);

    const response = await tool.execute({
      code: `
        const result = await callMCPTool('test__tool', { arg: 'value' });
        console.log(JSON.stringify(result));
      `,
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.success).toBe(true);
    expect(payload.stdout).toContain('pod1');
    expect(mockExecutor).toHaveBeenCalledWith('test__tool', { arg: 'value' });
  });

  it('provides searchTools helper for discovery', async () => {
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
        const results = searchTools('pods');
        console.log(JSON.stringify(results));
      `,
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.success).toBe(true);
    const searchResults = JSON.parse(payload.stdout);
    expect(searchResults.some((r: any) => r.name === 'list_pods')).toBe(true);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('provides getToolHelp helper for detailed docs', async () => {
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
        const help = getToolHelp('listItems');
        console.log(JSON.stringify(help));
      `,
    });

    const payload = JSON.parse(response.content[0].text);
    expect(payload.success).toBe(true);
    const helpData = JSON.parse(payload.stdout);
    expect(helpData.name).toBe('list_items');
    expect(helpData.parameters).toHaveLength(1);
    expect(helpData.parameters[0].name).toBe('namespace');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

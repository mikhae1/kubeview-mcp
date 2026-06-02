import { HelmDebugTool } from '../../src/tools/helm/HelmDebugTool.js';
import { HelmReleaseOperations } from '../../src/kubernetes/resources/HelmReleaseOperations.js';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient.js';

jest.mock('../../src/kubernetes/resources/HelmReleaseOperations.js', () => ({
  __esModule: true,
  HelmReleaseOperations: jest.fn(),
}));

describe('HelmDebugTool', () => {
  let tool: HelmDebugTool;
  let client: KubernetesClient;
  let getReleaseMock: jest.Mock;
  let getReleaseHistoryMock: jest.Mock;
  let getReleaseValuesMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    tool = new HelmDebugTool();
    getReleaseMock = jest.fn();
    getReleaseHistoryMock = jest.fn().mockResolvedValue([
      {
        revision: 1,
        status: 'deployed',
        description: 'Install complete',
      },
    ]);
    getReleaseValuesMock = jest.fn().mockResolvedValue({ image: { tag: '1.0.0' } });
    (HelmReleaseOperations as unknown as jest.Mock).mockImplementation(() => ({
      getRelease: getReleaseMock,
      getReleaseHistory: getReleaseHistoryMock,
      getReleaseValues: getReleaseValuesMock,
    }));
    client = {
      refreshCurrentContext: jest.fn().mockResolvedValue(undefined),
      getCurrentNamespace: jest.fn().mockReturnValue('default'),
      apps: {
        readNamespacedDeployment: jest.fn(),
      },
      core: {
        readNamespacedConfigMap: jest.fn(),
        listNamespacedPod: jest.fn().mockResolvedValue({ items: [] }),
        listNamespacedEvent: jest.fn().mockResolvedValue({ items: [] }),
      },
    } as any;
  });

  function mockRelease(manifest: string) {
    getReleaseMock.mockResolvedValue({
      storageBackend: 'secret',
      storageObjectName: 'sh.helm.release.v1.demo.v1',
      summary: {
        name: 'demo',
        namespace: 'default',
        revision: 1,
        updated: '2026-01-01T00:00:00.000Z',
        status: 'deployed',
        chart: 'demo-1.0.0',
        app_version: '1.0.0',
      },
      release: {
        info: { description: 'Install complete', notes: 'notes' },
        manifest,
      },
    });
  }

  it('returns healthy diagnostics for a ready release', async () => {
    mockRelease(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default' },
      spec: { replicas: 1, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 1, readyReplicas: 1 },
    });

    const result = await tool.execute({ releaseName: 'demo' }, client);

    expect(result.health.overall).toBe('healthy');
    expect(result.diagnosis.summary).toContain('Release appears healthy');
    expect(result.issues).toEqual([]);
    expect(result.workloads).toEqual([]);
    expect(result.resources).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('"spec"');
    expect(JSON.stringify(result)).not.toContain('rawKubernetesData');
    expect(result.release.hasNotes).toBe(true);
    expect(result.history).toHaveLength(1);
    expect(result.values).toBeUndefined();
    expect(result.manifest).toBeUndefined();
  });

  it('marks degraded diagnostics for unavailable workloads and correlated warning events', async () => {
    mockRelease(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default' },
      spec: { replicas: 2, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 2, readyReplicas: 1 },
    });
    (client as any).core.listNamespacedEvent.mockResolvedValue({
      items: [
        {
          type: 'Warning',
          reason: 'FailedScheduling',
          message: '0/1 nodes available',
          lastTimestamp: '2026-01-01T00:01:00.000Z',
          involvedObject: { kind: 'Deployment', name: 'demo', namespace: 'default' },
        },
        {
          type: 'Warning',
          reason: 'Ignored',
          message: 'different resource',
          lastTimestamp: '2026-01-01T00:02:00.000Z',
          involvedObject: { kind: 'Pod', name: 'other', namespace: 'default' },
        },
      ],
    });

    const result = await tool.execute({ releaseName: 'demo', eventLimit: 1 }, client);

    expect(result.health.overall).toBe('degraded');
    expect(result.health.warningEvents).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'demo',
        state: 'degraded',
        warningEvents: 1,
      }),
    );
    expect(result.workloads).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].reason).toBe('FailedScheduling');
  });

  it('marks missing resources as missing and includes optional values and manifest only when requested', async () => {
    mockRelease(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    (client as any).apps.readNamespacedDeployment.mockRejectedValue(new Error('not found'));

    const result = await tool.execute(
      {
        releaseName: 'demo',
        includeValues: true,
        includeManifest: true,
        includeEvents: false,
      },
      client,
    );

    expect(result.health.overall).toBe('missing');
    expect(result.issues[0].state).toBe('missing');
    expect(result.values).toEqual({ image: { tag: '1.0.0' } });
    expect(result.manifest).toContain('Deployment');
    expect(result.events).toBeUndefined();
  });

  it('includes healthy resource summaries only when showAllResources=true', async () => {
    mockRelease(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default' },
      spec: { replicas: 1, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 1, readyReplicas: 1 },
    });

    const result = await tool.execute(
      {
        releaseName: 'demo',
        showAllResources: true,
      },
      client,
    );

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toEqual(
      expect.objectContaining({
        kind: 'Deployment',
        name: 'demo',
        state: 'ready',
        evidence: expect.objectContaining({ readyReplicas: 1 }),
      }),
    );
    expect(result.resources[0].rawKubernetesData).toBeUndefined();
  });

  it('includes raw Kubernetes data only when showRawKubernetesData=true', async () => {
    mockRelease(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default', labels: { app: 'demo' } },
      spec: { replicas: 2, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 2, readyReplicas: 1 },
    });

    const result = await tool.execute(
      {
        releaseName: 'demo',
        showAllResources: true,
        showRawKubernetesData: true,
      },
      client,
    );

    expect(result.resources[0].rawKubernetesData).toEqual(
      expect.objectContaining({
        spec: expect.objectContaining({ replicas: 2 }),
        status: expect.objectContaining({ readyReplicas: 1 }),
        labels: { app: 'demo' },
      }),
    );
    expect(result.issues[0].rawKubernetesData).toBeDefined();
  });

  it('caps warning events and release history by their limits', async () => {
    mockRelease(`
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
`);
    getReleaseHistoryMock.mockResolvedValue([
      { revision: 3, status: 'deployed', description: 'three' },
      { revision: 2, status: 'superseded', description: 'two' },
      { revision: 1, status: 'superseded', description: 'one' },
    ]);
    (client as any).apps.readNamespacedDeployment.mockResolvedValue({
      metadata: { name: 'demo', namespace: 'default' },
      spec: { replicas: 1, selector: { matchLabels: { app: 'demo' } } },
      status: { replicas: 1, readyReplicas: 1 },
    });
    (client as any).core.listNamespacedEvent.mockResolvedValue({
      items: [
        {
          type: 'Warning',
          reason: 'First',
          lastTimestamp: '2026-01-01T00:03:00.000Z',
          involvedObject: { kind: 'Deployment', name: 'demo', namespace: 'default' },
        },
        {
          type: 'Warning',
          reason: 'Second',
          lastTimestamp: '2026-01-01T00:02:00.000Z',
          involvedObject: { kind: 'Deployment', name: 'demo', namespace: 'default' },
        },
      ],
    });

    const result = await tool.execute(
      {
        releaseName: 'demo',
        eventLimit: 1,
        historyLimit: 2,
      },
      client,
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].reason).toBe('First');
    expect(result.history).toHaveLength(2);
  });

  it('keeps compact output small for large healthy releases', async () => {
    const manifest = Array.from(
      { length: 40 },
      (_, index) => `
apiVersion: v1
kind: ConfigMap
metadata:
  name: cm-${index}
`,
    ).join('---\n');
    mockRelease(manifest);
    (client as any).core.readNamespacedConfigMap.mockImplementation(({ name }: any) =>
      Promise.resolve({
        metadata: { name, namespace: 'default' },
        data: { large: 'x'.repeat(100) },
      }),
    );

    const compact = await tool.execute({ releaseName: 'demo' }, client);
    const expanded = await tool.execute(
      { releaseName: 'demo', showAllResources: true, showRawKubernetesData: true },
      client,
    );

    expect(compact.issues).toHaveLength(0);
    expect(compact.resources).toBeUndefined();
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(expanded).length / 2);
  });
});

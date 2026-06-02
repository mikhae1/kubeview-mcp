import {
  getHelmLiveResources,
  parseHelmManifestResourceRefs,
  summarizeHelmResourceHealth,
} from '../../src/utils/HelmLiveResources.js';

describe('HelmLiveResources', () => {
  const manifest = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: apps
  labels:
    app: demo
---
apiVersion: example.com/v1
kind: Widget
metadata:
  name: custom
`;

  it('parses manifest resource refs with metadata', () => {
    const refs = parseHelmManifestResourceRefs(manifest, 'default');

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual(
      expect.objectContaining({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'demo',
        namespace: 'apps',
        labels: { app: 'demo' },
      }),
    );
    expect(refs[1]).toEqual(expect.objectContaining({ namespace: 'default' }));
  });

  it('fetches live resources and marks unsupported kinds', async () => {
    const client = {
      apps: {
        readNamespacedDeployment: jest.fn().mockResolvedValue({
          metadata: { name: 'demo', namespace: 'apps', uid: 'uid-1' },
          spec: { replicas: 2, selector: { matchLabels: { app: 'demo' } } },
          status: { replicas: 2, readyReplicas: 2 },
        }),
      },
      core: {
        listNamespacedPod: jest.fn().mockResolvedValue({ items: [] }),
      },
    } as any;

    const resources = await getHelmLiveResources(client, manifest, 'default');

    expect(resources[0].state).toBe('ready');
    expect(resources[0].live?.uid).toBe('uid-1');
    expect(resources[0].ref).not.toHaveProperty('manifest');
    expect(client.core.listNamespacedPod).toHaveBeenCalledWith({
      namespace: 'apps',
      labelSelector: 'app=demo',
    });
    expect(resources[1]).toEqual(
      expect.objectContaining({
        state: 'unsupported',
        reason: 'UnsupportedKind',
      }),
    );
  });

  it('marks missing resources and summarizes degraded health', async () => {
    const client = {
      apps: {
        readNamespacedDeployment: jest.fn().mockRejectedValue(new Error('not found')),
      },
      core: {
        listNamespacedPod: jest.fn(),
      },
    } as any;

    const resources = await getHelmLiveResources(client, manifest, 'default', 'Deployment');
    const health = summarizeHelmResourceHealth(resources);

    expect(resources[0].state).toBe('missing');
    expect(health.overall).toBe('missing');
    expect(health.missing).toBe(1);
  });

  it('supports common existence-only resources such as ServiceAccount', async () => {
    const client = {
      core: {
        readNamespacedServiceAccount: jest.fn().mockResolvedValue({
          metadata: { name: 'demo-sa', namespace: 'apps' },
        }),
      },
    } as any;

    const resources = await getHelmLiveResources(
      client,
      `
apiVersion: v1
kind: ServiceAccount
metadata:
  name: demo-sa
  namespace: apps
`,
      'default',
    );

    expect(resources[0].state).toBe('ready');
    expect(client.core.readNamespacedServiceAccount).toHaveBeenCalledWith({
      name: 'demo-sa',
      namespace: 'apps',
    });
  });

  it('keeps unknown state separate from degraded health', async () => {
    const health = summarizeHelmResourceHealth([
      {
        ref: {
          kind: 'Ingress',
          name: 'demo',
          namespace: 'apps',
          labels: {},
          annotations: {},
        },
        state: 'unknown',
      },
    ]);

    expect(health.overall).toBe('unknown');
    expect(health.degraded).toBe(0);
    expect(health.unknown).toBe(1);
    expect(health.supported).toBe(1);
  });
});

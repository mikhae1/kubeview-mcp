import { gzipSync } from 'zlib';
import { HelmReleaseOperations } from '../../src/kubernetes/resources/HelmReleaseOperations.js';
import { KubernetesClient } from '../../src/kubernetes/KubernetesClient.js';

function encodeReleasePayload(release: Record<string, unknown>): string {
  return gzipSync(Buffer.from(JSON.stringify(release), 'utf8')).toString('base64');
}

function buildSecret(params: {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  release: Record<string, unknown>;
}) {
  return {
    metadata: {
      name: params.name,
      namespace: params.namespace,
      labels: params.labels,
      creationTimestamp: new Date('2026-01-01T00:00:00.000Z'),
    },
    data: {
      release: encodeReleasePayload(params.release),
    },
  } as any;
}

function buildConfigMap(params: {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  release: Record<string, unknown>;
}) {
  return {
    metadata: {
      name: params.name,
      namespace: params.namespace,
      labels: params.labels,
      creationTimestamp: new Date('2026-01-01T00:00:00.000Z'),
    },
    data: {
      release: encodeReleasePayload(params.release),
    },
  } as any;
}

describe('HelmReleaseOperations', () => {
  let operations: HelmReleaseOperations;
  let mockClient: KubernetesClient;
  let secretOpsMock: {
    list: jest.Mock;
    get: jest.Mock;
  };
  let configMapOpsMock: {
    list: jest.Mock;
    get: jest.Mock;
  };

  beforeEach(() => {
    mockClient = {
      config: {
        logger: {
          error: jest.fn(),
          warn: jest.fn(),
          info: jest.fn(),
          debug: jest.fn(),
        },
      },
    } as any;

    operations = new HelmReleaseOperations(mockClient);
    secretOpsMock = {
      list: jest.fn(),
      get: jest.fn(),
    };
    configMapOpsMock = {
      list: jest.fn(),
      get: jest.fn(),
    };

    secretOpsMock.list.mockResolvedValue({ items: [] });
    configMapOpsMock.list.mockResolvedValue({ items: [] });

    (operations as any).secretOps = secretOpsMock;
    (operations as any).configMapOps = configMapOpsMock;
  });

  it('selects latest revision by default and exact revision when requested', async () => {
    const releaseName = 'my-release';
    const namespace = 'apps';

    const rev1 = buildSecret({
      name: 'sh.helm.release.v1.my-release.v1',
      namespace,
      labels: { owner: 'helm', name: releaseName, version: '1', status: 'superseded' },
      release: {
        name: releaseName,
        namespace,
        version: 1,
        info: { status: 'superseded', description: 'Initial install' },
        chart: { metadata: { name: 'demo', version: '0.1.0', appVersion: '1.0.0' } },
      },
    });

    const rev10 = buildSecret({
      name: 'sh.helm.release.v1.my-release.v10',
      namespace,
      labels: { owner: 'helm', name: releaseName, version: '10', status: 'deployed' },
      release: {
        name: releaseName,
        namespace,
        version: 10,
        info: { status: 'deployed', description: 'Upgrade complete' },
        chart: { metadata: { name: 'demo', version: '0.2.0', appVersion: '1.1.0' } },
      },
    });

    secretOpsMock.list.mockResolvedValue({ items: [rev1, rev10] });

    const latest = await operations.getRelease({ releaseName, namespace });
    expect(latest.summary.revision).toBe(10);
    expect(latest.summary.status).toBe('deployed');

    const exact = await operations.getRelease({ releaseName, namespace, revision: 1 });
    expect(exact.summary.revision).toBe(1);
    expect(exact.summary.status).toBe('superseded');
  });

  it('supports pending status filters for listReleases', async () => {
    const pending = buildSecret({
      name: 'sh.helm.release.v1.pending-rel.v3',
      namespace: 'apps',
      labels: { owner: 'helm', name: 'pending-rel', version: '3', status: 'pending-upgrade' },
      release: {
        name: 'pending-rel',
        namespace: 'apps',
        version: 3,
        info: { status: 'pending-upgrade' },
        chart: { metadata: { name: 'pending', version: '1.0.0', appVersion: '1.0.0' } },
      },
    });

    const deployed = buildSecret({
      name: 'sh.helm.release.v1.stable-rel.v4',
      namespace: 'apps',
      labels: { owner: 'helm', name: 'stable-rel', version: '4', status: 'deployed' },
      release: {
        name: 'stable-rel',
        namespace: 'apps',
        version: 4,
        info: { status: 'deployed' },
        chart: { metadata: { name: 'stable', version: '1.0.0', appVersion: '1.0.0' } },
      },
    });

    secretOpsMock.list.mockResolvedValue({ items: [pending, deployed] });

    const result = await operations.listReleases({ statuses: ['pending'] });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('pending-rel');
    expect(secretOpsMock.list).toHaveBeenCalledWith(
      expect.objectContaining({
        labelSelector: expect.stringContaining(
          'status in (pending-install,pending-upgrade,pending-rollback)',
        ),
      }),
    );
  });

  it('returns release history sorted by revision descending', async () => {
    const releaseName = 'hist-rel';
    const namespace = 'apps';

    const rev2 = buildSecret({
      name: 'sh.helm.release.v1.hist-rel.v2',
      namespace,
      labels: { owner: 'helm', name: releaseName, version: '2', status: 'superseded' },
      release: {
        name: releaseName,
        namespace,
        version: 2,
        info: { status: 'superseded', description: 'Second rollout' },
        chart: { metadata: { name: 'hist', version: '0.2.0', appVersion: '2.0.0' } },
      },
    });

    const rev5 = buildSecret({
      name: 'sh.helm.release.v1.hist-rel.v5',
      namespace,
      labels: { owner: 'helm', name: releaseName, version: '5', status: 'deployed' },
      release: {
        name: releaseName,
        namespace,
        version: 5,
        info: { status: 'deployed', description: 'Current' },
        chart: { metadata: { name: 'hist', version: '0.5.0', appVersion: '5.0.0' } },
      },
    });

    secretOpsMock.list.mockResolvedValue({ items: [rev2, rev5] });

    const history = await operations.getReleaseHistory({ releaseName, namespace });
    expect(history).toHaveLength(2);
    expect(history[0].revision).toBe(5);
    expect(history[0].description).toBe('Current');
    expect(history[1].revision).toBe(2);
  });

  it('loads releases from configmap backend when secrets are absent', async () => {
    const releaseName = 'configmap-release';
    const namespace = 'apps';

    const fromConfigMap = buildConfigMap({
      name: 'sh.helm.release.v1.configmap-release.v4',
      namespace,
      labels: { owner: 'helm', name: releaseName, version: '4', status: 'deployed' },
      release: {
        name: releaseName,
        namespace,
        version: 4,
        info: { status: 'deployed' },
        chart: { metadata: { name: 'cfg', version: '1.4.0', appVersion: '4.0.0' } },
      },
    });

    configMapOpsMock.list.mockResolvedValue({ items: [fromConfigMap] });

    const result = await operations.getRelease({ releaseName, namespace });

    expect(result.storageBackend).toBe('configmap');
    expect(result.storageObjectName).toBe('sh.helm.release.v1.configmap-release.v4');
    expect(result.summary.revision).toBe(4);
    expect(result.summary.status).toBe('deployed');
  });

  it('prefers secret backend over configmap for same release revision', async () => {
    const secret = buildSecret({
      name: 'sh.helm.release.v1.shared.v7',
      namespace: 'apps',
      labels: { owner: 'helm', name: 'shared', version: '7', status: 'deployed' },
      release: {
        name: 'shared',
        namespace: 'apps',
        version: 7,
        info: { status: 'deployed' },
        chart: { metadata: { name: 'secret-chart', version: '7.0.0', appVersion: '7.0.0' } },
      },
    });

    const configMap = buildConfigMap({
      name: 'sh.helm.release.v1.shared.v7',
      namespace: 'apps',
      labels: { owner: 'helm', name: 'shared', version: '7', status: 'deployed' },
      release: {
        name: 'shared',
        namespace: 'apps',
        version: 7,
        info: { status: 'deployed' },
        chart: { metadata: { name: 'cfg-chart', version: '7.0.0', appVersion: '7.0.0' } },
      },
    });

    secretOpsMock.list.mockResolvedValue({ items: [secret] });
    configMapOpsMock.list.mockResolvedValue({ items: [configMap] });

    const list = await operations.listReleases({ namespace: 'apps' });
    expect(list).toHaveLength(1);
    expect(list[0].chart).toBe('secret-chart-7.0.0');
  });
});

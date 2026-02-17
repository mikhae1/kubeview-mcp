import { gzipSync } from 'zlib';
import {
  extractValues,
  parseHelmSecret,
  parseManifestResources,
} from '../../src/utils/HelmDataParser.js';

function encodeReleasePayload(release: Record<string, unknown>, doubleBase64 = false): string {
  const json = JSON.stringify(release);
  const gzipped = gzipSync(Buffer.from(json, 'utf8'));
  const single = gzipped.toString('base64');
  return doubleBase64 ? Buffer.from(single, 'utf8').toString('base64') : single;
}

describe('HelmDataParser', () => {
  it('parses single-base64 gzipped Helm secret payload', () => {
    const release = {
      name: 'demo',
      namespace: 'default',
      version: 3,
      info: { status: 'deployed' },
    };

    const encoded = encodeReleasePayload(release, false);
    const parsed = parseHelmSecret(encoded);

    expect(parsed.name).toBe('demo');
    expect(parsed.namespace).toBe('default');
    expect(parsed.version).toBe(3);
    expect(parsed.info?.status).toBe('deployed');
  });

  it('parses double-base64 gzipped Helm secret payload', () => {
    const release = {
      name: 'demo-double',
      namespace: 'kube-system',
      version: 9,
      info: { status: 'pending-upgrade' },
    };

    const encoded = encodeReleasePayload(release, true);
    const parsed = parseHelmSecret(encoded);

    expect(parsed.name).toBe('demo-double');
    expect(parsed.namespace).toBe('kube-system');
    expect(parsed.version).toBe(9);
    expect(parsed.info?.status).toBe('pending-upgrade');
  });

  it('throws clear error for malformed release payload', () => {
    expect(() => parseHelmSecret('not-a-valid-helm-payload')).toThrow(
      'Failed to decompress release data',
    );
  });

  it('merges chart defaults with user values for allValues', () => {
    const release = {
      chart: {
        values: {
          image: { tag: '1.0.0', pullPolicy: 'IfNotPresent' },
          replicaCount: 1,
        },
      },
      config: {
        image: { tag: '2.0.0' },
      },
    };

    const merged = extractValues(release as any, true);
    expect(merged).toEqual({
      image: { tag: '2.0.0', pullPolicy: 'IfNotPresent' },
      replicaCount: 1,
    });
  });

  it('parses and filters resources from manifest text', () => {
    const manifest = `
apiVersion: v1
kind: Service
metadata:
  name: my-svc
  namespace: default
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deploy
  namespace: default
`;

    const all = parseManifestResources(manifest);
    const deployments = parseManifestResources(manifest, 'Deployment');

    expect(all).toHaveLength(2);
    expect(deployments).toHaveLength(1);
    expect(deployments[0].kind).toBe('Deployment');
    expect(deployments[0].name).toBe('my-deploy');
  });
});

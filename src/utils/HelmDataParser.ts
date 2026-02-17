import { gunzipSync } from 'zlib';
import { isSensitiveMaskEnabled, maskTextForSensitiveValues } from './SensitiveData.js';

export interface HelmChartMetadata {
  name?: string;
  version?: string;
  appVersion?: string;
}

export interface HelmChart {
  metadata?: HelmChartMetadata;
  values?: Record<string, unknown>;
}

export interface HelmReleaseInfo {
  status?: string;
  description?: string;
  notes?: string;
  first_deployed?: unknown;
  last_deployed?: unknown;
  deleted?: unknown;
}

export interface HelmHook {
  name?: string;
  kind?: string;
  path?: string;
  manifest?: string;
  events?: string[];
  [key: string]: unknown;
}

export interface HelmReleaseData {
  name?: string;
  namespace?: string;
  version?: number;
  info?: HelmReleaseInfo;
  chart?: HelmChart;
  config?: Record<string, unknown>;
  manifest?: string;
  hooks?: HelmHook[];
  [key: string]: unknown;
}

export interface ParsedManifestResource {
  kind: string;
  namespace?: string;
  name?: string;
  manifest: string;
}

function isLikelyBase64(input: string): boolean {
  const normalized = input.replace(/\s+/g, '');
  return (
    normalized.length > 0 && normalized.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(normalized)
  );
}

function decodeAndInflateReleaseData(encodedReleaseData: string): string {
  if (!encodedReleaseData || typeof encodedReleaseData !== 'string') {
    throw new Error('Invalid Helm secret format: missing release payload');
  }

  let firstDecode: Buffer;
  try {
    firstDecode = Buffer.from(encodedReleaseData, 'base64');
  } catch {
    throw new Error('Invalid Helm secret format: release payload is not valid base64');
  }

  const gunzipCandidates: Buffer[] = [];
  const firstDecodeText = firstDecode.toString('utf8').trim();
  if (isLikelyBase64(firstDecodeText)) {
    gunzipCandidates.push(Buffer.from(firstDecodeText, 'base64'));
  }
  gunzipCandidates.push(firstDecode);

  for (const candidate of gunzipCandidates) {
    try {
      return gunzipSync(candidate).toString('utf8');
    } catch {
      continue;
    }
  }

  for (const candidate of gunzipCandidates) {
    const asText = candidate.toString('utf8').trim();
    if (asText.startsWith('{') || asText.startsWith('[')) {
      return asText;
    }
  }

  throw new Error('Failed to decompress release data');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function parseHelmSecret(encodedReleaseData: string): HelmReleaseData {
  const decompressed = decodeAndInflateReleaseData(encodedReleaseData);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decompressed);
  } catch {
    throw new Error('Invalid Helm secret format: release payload is not valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new Error('Invalid Helm secret format: release payload is not an object');
  }

  return parsed as HelmReleaseData;
}

export function extractValues(
  release: HelmReleaseData,
  allValues = false,
): Record<string, unknown> {
  const userValues = isRecord(release.config) ? cloneObject(release.config) : {};
  if (!allValues) {
    return userValues;
  }

  const chartValues = isRecord(release.chart?.values) ? cloneObject(release.chart.values) : {};
  return deepMerge(chartValues, userValues);
}

export function extractManifest(release: HelmReleaseData): string {
  return typeof release.manifest === 'string' ? release.manifest : '';
}

export function extractNotes(release: HelmReleaseData): string {
  return typeof release.info?.notes === 'string' ? release.info.notes : '';
}

export function extractHooks(release: HelmReleaseData): HelmHook[] {
  return Array.isArray(release.hooks) ? release.hooks : [];
}

export function parseManifestResources(
  manifestText: string,
  filterType?: string,
): ParsedManifestResource[] {
  const docs = String(manifestText)
    .split(/^---\s*$/m)
    .map((doc) => doc.trim())
    .filter(Boolean);

  const resources: ParsedManifestResource[] = [];
  for (const doc of docs) {
    const kindMatch = doc.match(/\n?kind:\s*(.+)\n/i) || doc.match(/^kind:\s*(.+)$/im);
    const namespaceMatch =
      doc.match(/\n?namespace:\s*(.+)\n/i) || doc.match(/^namespace:\s*(.+)$/im);
    const nameMatch = doc.match(/\n?name:\s*(.+)\n/i) || doc.match(/^name:\s*(.+)$/im);

    const kind = kindMatch ? kindMatch[1].trim() : undefined;
    if (!kind) {
      continue;
    }

    if (filterType && kind.toLowerCase() !== filterType.toLowerCase()) {
      continue;
    }

    resources.push({
      kind,
      namespace: namespaceMatch ? namespaceMatch[1].trim() : undefined,
      name: nameMatch ? nameMatch[1].trim() : undefined,
      manifest: doc,
    });
  }

  return resources;
}

export function formatHelmTimestamp(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }

  if (isRecord(value) && typeof value.time === 'string') {
    const parsed = Date.parse(value.time);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value.time;
  }

  if (isRecord(value) && (typeof value.seconds === 'number' || typeof value.seconds === 'string')) {
    const seconds = Number(value.seconds);
    const nanos = Number(value.nanos ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanos)) {
      const date = new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
      if (!Number.isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  return undefined;
}

export function maskSensitiveText(text: string): string {
  if (!isSensitiveMaskEnabled()) {
    return text;
  }
  return maskTextForSensitiveValues(text);
}

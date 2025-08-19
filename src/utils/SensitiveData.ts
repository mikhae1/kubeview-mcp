/**
 * Utilities for masking sensitive data across outputs
 */

const DEFAULT_MASK = '*** FILTERED ***';

/**
 * Returns true when global masking is enabled via environment variable.
 * Supported flags: MCP_HIDE_SENSITIVE, HIDE_SENSITIVE_DATA, MASK_SENSITIVE_DATA
 */
export function isSensitiveMaskEnabled(): boolean {
  const value =
    process.env.MCP_HIDE_SENSITIVE ||
    process.env.MCP_HIDE_SENSITIVE_DATA ||
    process.env.MCP_MASK_SENSITIVE_DATA ||
    '';
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

/**
 * Returns the mask string to use. Can be overridden via SENSITIVE_MASK env var.
 */
export function getMaskString(): string {
  return process.env.MCP_SENSITIVE_MASK || DEFAULT_MASK;
}

/**
 * Key patterns that imply the value is sensitive and should be fully masked.
 */
export const sensitiveKeyRegexes: RegExp[] = [
  /(?:password|passwd|pwd)/i,
  /(?:secret|token)/i,
  /api[_-]?(?:key|token|secret|password)/i,
  /auth[_-]?(?:token|secret)/i,
  /access(?:[_-]?key)?/i,
  /refresh[_-]?token/i,
  /client[_-]?(?:id|secret)/i,
  /credential(?:s)?/i,
  /(?:ssh|tls|ssl|x509).*key/i,
  /cert(?:ificate)?/i,
];

/**
 * Value patterns for secret-like strings (used for plain text masking where keys are unknown)
 */
export const sensitiveValueRegexes: RegExp[] = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /ssh-(?:rsa|dss|ed25519|ecdsa)\s+[A-Za-z0-9+/=]+[^\r\n]*/gi, // SSH public keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS Access Key ID
  /[A-Za-z0-9+/]{40}/g, // AWS Secret Access Key-like
  /\b(?:api[_-]?key|token|secret|auth[_-]?key|access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9+/=_-]{16,}['"]?/gi,
  /\b(?:password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{6,}['"]?/gi,
  /(?:postgresql|mysql|mongodb|redis):\/\/[^:]+:[^@]+@[^\s]+/gi, // URLs with creds
];

/**
 * Mask sensitive values in a plain text blob (YAML/JSON or free text)
 * - Masks RHS of key-value pairs for common sensitive keys
 * - Replaces secret-like tokens with mask
 */
export function maskTextForSensitiveValues(text: string): string {
  const mask = getMaskString();
  let output = text;

  // YAML-style key: value masking
  const yamlKeyPatterns = [
    /(password|passwd|pwd)\s*:\s*.+/gi,
    /(secret|token)\s*:\s*.+/gi,
    /(api[_-]?(?:key|token|secret|password))\s*:\s*.+/gi,
    /(auth[_-]?(?:token|secret))\s*:\s*.+/gi,
    /(access(?:[_-]?key)?)\s*:\s*.+/gi,
    /(client[_-]?(?:id|secret))\s*:\s*.+/gi,
    /(credential(?:s)?)\s*:\s*.+/gi,
  ];
  for (const regex of yamlKeyPatterns) {
    output = output.replace(regex, (line) => {
      const parts = line.split(':');
      return `${parts[0]}: ${mask}`;
    });
  }

  // JSON-style "key": value masking (preserve quotes)
  const jsonKeyPatterns = [
    /("(?:password|passwd|pwd)")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
    /("(?:secret|token)")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
    /("api[_-]?(?:key|token|secret|password)")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
    /("auth[_-]?(?:token|secret)")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
    /("access(?:[_-]?key)?")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
    /("client[_-]?(?:id|secret)")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
    /("credential(?:s)?")\s*:\s*("[^"]*"|[^,}\n]+)/gi,
  ];
  for (const regex of jsonKeyPatterns) {
    output = output.replace(regex, (_match, key) => `${key}: "${mask}"`);
  }

  // Replace known secret-like tokens anywhere
  for (const regex of sensitiveValueRegexes) {
    regex.lastIndex = 0;
    output = output.replace(regex, mask);
  }

  return output;
}

/**
 * Recursively mask values in an object based on key names and string values.
 */
export function maskObjectDeep<T = any>(input: T): T {
  const mask = getMaskString();

  if (input === null || input === undefined) return input;

  if (Array.isArray(input)) {
    return input.map((item) => maskObjectDeep(item)) as any;
  }

  if (typeof input === 'object') {
    const result: any = Array.isArray(input) ? [] : { ...input };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string') {
        if (sensitiveKeyRegexes.some((r) => r.test(key))) {
          result[key] = mask;
          continue;
        }
        let maskedValue = value;
        for (const regex of sensitiveValueRegexes) {
          regex.lastIndex = 0;
          maskedValue = maskedValue.replace(regex, mask);
        }
        result[key] = maskedValue;
      } else if (typeof value === 'object' && value !== null) {
        result[key] = maskObjectDeep(value);
      } else {
        // primitive non-string
        if (sensitiveKeyRegexes.some((r) => r.test(key))) {
          result[key] = mask;
        }
      }
    }
    return result;
  }

  // primitive
  if (typeof input === 'string') {
    return maskTextForSensitiveValues(input) as any;
  }
  return input;
}

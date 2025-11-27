const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_REGEX = /\+?\d[\d\s().-]{7,}\d/;

/**
 * Naive PII tokenizer that replaces sensitive string values with deterministic tokens.
 * This keeps raw values out of logs and the model context while allowing round-tripping.
 */
export class PIITokenizer {
  private readonly tokenToValue = new Map<string, unknown>();
  private counter = 0;

  tokenize<T>(value: T): T {
    return this.transform(value, true);
  }

  detokenize<T>(value: T): T {
    return this.transform(value, false);
  }

  private transform<T>(value: T, encode: boolean): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.transform(item, encode)) as T;
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = this.transform(val, encode);
      }
      return result as T;
    }

    if (typeof value === 'string') {
      return (encode ? this.encodeString(value) : this.decodeString(value)) as T;
    }

    return value;
  }

  private encodeString(value: string): string {
    if (!this.shouldTokenize(value)) {
      return value;
    }

    const token = `[PII_${++this.counter}]`;
    this.tokenToValue.set(token, value);
    return token;
  }

  private decodeString(value: string): string {
    const decoded = this.tokenToValue.get(value);
    if (typeof decoded === 'string') {
      return decoded;
    }
    return value;
  }

  private shouldTokenize(value: string): boolean {
    return EMAIL_REGEX.test(value) || PHONE_REGEX.test(value);
  }
}

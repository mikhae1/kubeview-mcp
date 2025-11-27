import { PIITokenizer } from '../../src/agent/security/PIITokenizer.js';

describe('PIITokenizer', () => {
  it('tokenizes and detokenizes email addresses', () => {
    const tokenizer = new PIITokenizer();
    const payload = { email: 'user@example.com', note: 'unchanged' };

    const tokenized = tokenizer.tokenize(payload);
    expect(tokenized.email).toMatch(/\[PII_\d+\]/);
    expect(tokenized.note).toBe('unchanged');

    const restored = tokenizer.detokenize(tokenized);
    expect(restored).toEqual(payload);
  });

  it('ignores non-PII strings', () => {
    const tokenizer = new PIITokenizer();
    const value = { message: 'hello world' };
    const tokenized = tokenizer.tokenize(value);
    expect(tokenized).toEqual(value);
  });
});

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function isMcpToolResult(value: unknown): value is CallToolResult {
  if (!value || typeof value !== 'object') return false;
  const anyValue = value as any;
  if (!Array.isArray(anyValue.content)) return false;
  return anyValue.content.every(
    (block: any) =>
      block &&
      typeof block === 'object' &&
      typeof block.type === 'string' &&
      (block.type !== 'text' || typeof block.text === 'string'),
  );
}

export function toMcpToolResult(value: unknown): CallToolResult {
  if (isMcpToolResult(value)) return value;
  const text =
    typeof value === 'string'
      ? value
      : value === undefined
        ? 'undefined'
        : JSON.stringify(value, null, 2);
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

// Removes database connection strings from anything that may be logged (I-02, NFR-SEC).
const CONNECTION_STRING = /postgres(?:ql)?:\/\/[^\s'"`]+/gi;

export function redact(value: unknown): string {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return text.replace(CONNECTION_STRING, 'postgresql://[redacted]');
}

/** Minimal logger that redacts every message before writing it. */
export const logger = {
  info: (...parts: unknown[]) => console.log(parts.map(redact).join(' ')),
  warn: (...parts: unknown[]) => console.warn(parts.map(redact).join(' ')),
  error: (...parts: unknown[]) => console.error(parts.map(redact).join(' ')),
};

// Structured JSON logging with a request ID on every line (I-05, NFR-OBS). Every line is passed
// through redact(), so connection strings never reach the logs (I-02).
import { redact } from './redact';

type Level = 'info' | 'warn' | 'error';

function serialise(value: unknown): unknown {
  if (value instanceof Error) return redact(value);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  }
  return value;
}

export function formatLine(level: Level, requestId: string, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, requestId, msg, ...(serialise(fields) as object) });
  return redact(line);
}

/** A logger bound to one request ID; every line it writes carries that ID. */
export function requestLogger(requestId: string) {
  const write = (level: Level) => (msg: string, fields?: Record<string, unknown>) => {
    const line = formatLine(level, requestId, msg, fields);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

// I-05: every log line carries the request ID and is redacted.
import { formatLine, requestLogger } from '../src/lib/log';

afterEach(() => jest.restoreAllMocks());

test('formatLine emits JSON with time, level, requestId and msg', () => {
  const line = JSON.parse(formatLine('info', 'req-1', 'hello', { a: 1 }));
  expect(line).toMatchObject({ level: 'info', requestId: 'req-1', msg: 'hello', a: 1 });
  expect(Date.parse(line.time)).not.toBeNaN();
});

test('every line written by a request logger includes its request ID', () => {
  const out: string[] = [];
  for (const m of ['log', 'warn', 'error'] as const) {
    jest.spyOn(console, m).mockImplementation((...args: unknown[]) => {
      out.push(String(args[0]));
    });
  }
  const log = requestLogger('req-42');
  log.info('a');
  log.warn('b', { x: 1 });
  log.error('c', { error: new Error('x') });
  expect(out).toHaveLength(3);
  for (const l of out) expect(JSON.parse(l).requestId).toBe('req-42');
});

test('connection strings in fields and errors are redacted', () => {
  const url = ['postgresql://', 'u', ':', 'fake-test-only', '@h:5432/d'].join('');
  const line = formatLine('error', 'r', 'db', { url, error: new Error(`at ${url}`) });
  expect(line).not.toContain('fake-test-only');
  expect(line).toContain('postgresql://[redacted]');
});

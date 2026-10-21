import { logger, redact } from '../src/lib/redact';

// Test-only connection strings, assembled from parts at runtime so no literal credential-shaped
// URL is committed (avoids secret-scanner false positives). None of these values is real.
const FAKE_CRED = 'fake-test-only';
const conn = (scheme: string, user: string, cred: string, rest: string) =>
  `${scheme}://${user}:${cred}@${rest}`;
const URL = conn('postgresql', 'janawaaz', FAKE_CRED, 'localhost:5433/janawaaz?sslmode=require');

describe('redact', () => {
  test('replaces postgres and postgresql connection strings', () => {
    expect(redact(`connect ${URL} failed`)).toBe('connect postgresql://[redacted] failed');
    expect(redact(conn('postgres', 'u', 'p', 'h:5432/d'))).toBe('postgresql://[redacted]');
  });

  test('redacts URLs inside Error messages', () => {
    const out = redact(new Error(`Can't reach ${URL}`));
    expect(out).not.toContain(FAKE_CRED);
    expect(out).toContain('postgresql://[redacted]');
  });

  test('leaves text without connection strings unchanged', () => {
    expect(redact('Database schema is up to date!')).toBe('Database schema is up to date!');
  });

  test('logger never writes a connection string', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('db error', new Error(`at ${URL}`));
    const written = spy.mock.calls.flat().join(' ');
    spy.mockRestore();
    expect(written).not.toMatch(/postgres(ql)?:\/\/[^[]/);
    expect(written).not.toContain(FAKE_CRED);
  });
});

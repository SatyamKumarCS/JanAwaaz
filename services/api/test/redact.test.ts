import { logger, redact } from '../src/lib/redact';

const URL = 'postgresql://janawaaz:change-me-local-only@localhost:5433/janawaaz?sslmode=require';

describe('redact', () => {
  test('replaces postgres and postgresql connection strings', () => {
    expect(redact(`connect ${URL} failed`)).toBe('connect postgresql://[redacted] failed');
    expect(redact('postgres://u:p@h:5432/d')).toBe('postgresql://[redacted]');
  });

  test('redacts URLs inside Error messages', () => {
    const out = redact(new Error(`Can't reach ${URL}`));
    expect(out).not.toContain('change-me-local-only');
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
    expect(written).not.toContain('change-me-local-only');
  });
});

import { createStatusHistoryRepository } from '../src/db/status-history-repo';

describe('status_history repository (append-only, NFR-AUDIT)', () => {
  const fakePrisma = {
    statusHistory: {
      create: jest.fn(async ({ data }) => ({ id: 1, ...data })),
      findMany: jest.fn(async () => []),
    },
  } as never;
  const repo = createStatusHistoryRepository(fakePrisma);

  test('exposes only append and listForComplaint', () => {
    expect(Object.keys(repo).sort()).toEqual(['append', 'listForComplaint']);
  });

  test('has no update or delete operation and cannot gain one', () => {
    const r = repo as unknown as Record<string, unknown>;
    for (const name of ['update', 'updateMany', 'delete', 'deleteMany', 'upsert', 'remove']) {
      expect(r[name]).toBeUndefined();
    }
    expect(Object.isFrozen(repo)).toBe(true);
  });
});

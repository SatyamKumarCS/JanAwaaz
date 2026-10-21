// Citizen persistence used by registration and authentication (I-07). Citizens are not `users`.
import type { PrismaClient } from '../generated/prisma/client';

export type Locale = 'hi' | 'en';
export type IntegrityTier = 'passed' | 'failed' | 'unknown';

export interface CitizenRecord {
  id: number;
  locale: Locale;
  integrity_tier: IntegrityTier;
  blocked_at: Date | null;
  last_seen_at: Date | null;
}

export interface CitizenStore {
  create(tokenHash: string, locale: Locale): Promise<CitizenRecord>;
  findByTokenHash(tokenHash: string): Promise<CitizenRecord | null>;
  touch(id: number, at: Date): Promise<void>;
}

const SELECT = { id: true, locale: true, integrity_tier: true, blocked_at: true, last_seen_at: true } as const;

export function prismaCitizenStore(prisma: PrismaClient): CitizenStore {
  return {
    create: (token_hash, locale) => prisma.citizen.create({ data: { token_hash, locale }, select: SELECT }),
    findByTokenHash: (token_hash) => prisma.citizen.findUnique({ where: { token_hash }, select: SELECT }),
    touch: async (id, at) => {
      await prisma.citizen.update({ where: { id }, data: { last_seen_at: at } });
    },
  };
}

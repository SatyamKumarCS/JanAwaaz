// Citizen registration and authentication (I-07a; D-02 Q1–Q3).
// - POST /auth/citizen/register issues a fresh 256-bit token; only its SHA-256 hash is stored.
//   No name, phone or email is accepted (DEV-D02): unknown body fields are rejected.
// - requireCitizen: 401 without a valid token. res.locals.citizen is set for owner routes, which must
//   also call ensureOwner (403 for another citizen's resource). Public /track never uses these.
// Play Integrity is not implemented: its free-gate check comes first (D-02 Q2), so every citizen is
// `unknown` for now, which is the stricter tier and never blocks registration.
import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { RateLimits } from '../config/rate-limits';
import { HttpError } from '../http/errors';
import { type RateLimitStore, rateLimit } from '../http/rate-limit';
import { validateBody } from '../http/validate';
import type { CitizenRecord, CitizenStore } from './store';
import { hashCitizenToken, newCitizenToken, TOKEN_FORMAT } from './token';

// An empty POST (no body at all) is a valid registration.
const RegisterBody = z.preprocess((v) => v ?? {}, z.object({ locale: z.enum(['hi', 'en']).optional() }).strict());

const UNAUTHORIZED_EN = 'A valid citizen credential is required.';
const UNAUTHORIZED_HI = 'मान्य नागरिक पहचान आवश्यक है।';
const FORBIDDEN_EN = 'This item belongs to someone else.';
const FORBIDDEN_HI = 'यह किसी और से संबंधित है।';

/** last_seen_at is refreshed at most this often, to keep authentication to one read per request. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface CitizenAuthDeps {
  store: CitizenStore;
  rateLimitStore: RateLimitStore;
  limits: RateLimits;
  now?: () => number;
}

export function citizenAuthRouter(deps: CitizenAuthDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  router.post(
    '/auth/citizen/register',
    rateLimit({ scope: 'register_ip_hour', limit: deps.limits.registerPerIpHour, windowSeconds: 3600, store: deps.rateLimitStore, now }),
    rateLimit({ scope: 'register_ip_day', limit: deps.limits.registerPerIpDay, windowSeconds: 86_400, store: deps.rateLimitStore, now }),
    validateBody(RegisterBody),
    async (_req, res, next) => {
      try {
        const body = res.locals.body as z.infer<typeof RegisterBody>;
        const token = newCitizenToken();
        const citizen = await deps.store.create(hashCitizenToken(token), body.locale ?? 'hi');
        res.setHeader('Cache-Control', 'no-store');
        res.status(201).json({ token, locale: citizen.locale, integrity_tier: citizen.integrity_tier });
      } catch (err) {
        next(err);
      }
    },
  );
  return router;
}

function bearer(header: string | undefined): string | null {
  const m = /^Bearer ([^\s]+)$/.exec(header ?? '');
  return m && TOKEN_FORMAT.test(m[1]!) ? m[1]! : null;
}

export function requireCitizen(deps: Pick<CitizenAuthDeps, 'store' | 'now'>): RequestHandler {
  const now = deps.now ?? Date.now;
  return async (req, res, next) => {
    try {
      const token = bearer(req.get('authorization'));
      const citizen = token ? await deps.store.findByTokenHash(hashCitizenToken(token)) : null;
      if (!citizen) {
        res.setHeader('WWW-Authenticate', 'Bearer');
        next(new HttpError(401, 'unauthorized', UNAUTHORIZED_EN, { message_hi: UNAUTHORIZED_HI }));
        return;
      }
      const t = now();
      if (!citizen.last_seen_at || t - citizen.last_seen_at.getTime() >= TOUCH_INTERVAL_MS) {
        await deps.store.touch(citizen.id, new Date(t));
      }
      res.locals.citizen = citizen;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Owner check for citizen-owned resources: 403 when the resource belongs to another citizen. */
export function ensureOwner(citizen: CitizenRecord, ownerCitizenId: number | null): void {
  if (ownerCitizenId === null || ownerCitizenId !== citizen.id) {
    throw new HttpError(403, 'forbidden', FORBIDDEN_EN, { message_hi: FORBIDDEN_HI });
  }
}

// Configurable rate limits (D-02 Q3, spec §7): `RATE_LIMITS_*` environment variables with the decided
// defaults. Only limits that have a route are listed; later slices add theirs here.
export interface RateLimits {
  registerPerIpHour: number;
  registerPerIpDay: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = {
  registerPerIpHour: 10,
  registerPerIpDay: 30,
};

const ENV: Record<keyof RateLimits, string> = {
  registerPerIpHour: 'RATE_LIMITS_REGISTER_PER_IP_HOUR',
  registerPerIpDay: 'RATE_LIMITS_REGISTER_PER_IP_DAY',
};

/** Reads overrides from the environment; a malformed value fails startup instead of silently defaulting. */
export function rateLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RateLimits {
  const out = { ...DEFAULT_RATE_LIMITS };
  for (const [key, name] of Object.entries(ENV) as [keyof RateLimits, string][]) {
    const raw = env[name];
    if (raw === undefined || raw === '') continue;
    if (!/^\d+$/.test(raw) || Number(raw) < 1) throw new Error(`${name} must be a positive integer, got "${raw}"`);
    out[key] = Number(raw);
  }
  return out;
}

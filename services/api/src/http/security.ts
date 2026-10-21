// Security headers and HTTPS-only enforcement (I-05, NFR-SEC).
import type { RequestHandler } from 'express';
import { HttpError } from './errors';

export const securityHeaders =
  (opts: { hsts: boolean }): RequestHandler =>
  (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (opts.hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };

/**
 * Rejects plain-HTTP requests (as seen through the trusted proxy's X-Forwarded-Proto). Health
 * checks are exempt because platform probes reach the service over plain HTTP inside the network.
 * Requests are rejected rather than redirected so a spoofed Host header can never steer a redirect.
 */
export const requireHttps: RequestHandler = (req, _res, next) => {
  if (req.secure || req.path.startsWith('/health')) {
    next();
    return;
  }
  next(new HttpError(400, 'https_required', 'HTTPS is required'));
};

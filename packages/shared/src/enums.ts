import { z } from 'zod';

// Single source of truth for shared enums (spec §3.2). Prisma enums and the Python
// Enums are kept in sync by parity tests against the committed enums.json.

export const ComplaintStatus = z.enum([
  'submitted',
  'verified',
  'routed',
  'assigned',
  'in_progress',
  'resolved',
  'rejected',
  'escalated',
]);
export type ComplaintStatus = z.infer<typeof ComplaintStatus>;

export const Category = z.enum(['roads', 'sanitation', 'streetlights', 'water_supply', 'drainage']);
export type Category = z.infer<typeof Category>;

export const Priority = z.enum(['low', 'medium', 'high', 'critical']);
export type Priority = z.infer<typeof Priority>;

export const ENUMS = {
  ComplaintStatus: ComplaintStatus.options,
  Category: Category.options,
  Priority: Priority.options,
} as const;

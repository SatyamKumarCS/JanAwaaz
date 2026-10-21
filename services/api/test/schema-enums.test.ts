// Enums must match spec §3.2 exactly (I-02) and the shared zod contract (packages/shared).
import { ENUMS } from '@janawaaz/shared';
import {
  AreaType,
  Category,
  ComplaintStatus,
  NotificationStatus,
  Priority,
  StatusHistoryEvent,
} from '../src/generated/prisma/enums';

const values = (e: Record<string, string>) => Object.values(e);

describe('Prisma enums match spec §3.2', () => {
  test('status is exactly the PRD set (no closed)', () => {
    expect(values(ComplaintStatus)).toEqual([
      'submitted', 'verified', 'routed', 'assigned', 'in_progress', 'resolved', 'rejected', 'escalated',
    ]);
    expect(values(ComplaintStatus)).not.toContain('closed');
  });

  test('category has exactly the 5 PRD values (no power)', () => {
    expect(values(Category)).toEqual(['roads', 'sanitation', 'streetlights', 'water_supply', 'drainage']);
    expect(values(Category)).not.toContain('power');
  });

  test('priority, area_type and notification status', () => {
    expect(values(Priority)).toEqual(['low', 'medium', 'high', 'critical']);
    expect(values(AreaType)).toEqual(['urban', 'rural']);
    expect(values(NotificationStatus)).toEqual(['queued', 'sent', 'failed']);
  });

  test('status_history.event includes escalated (spec §3.2, D-04 Q5)', () => {
    expect(values(StatusHistoryEvent)).toEqual(['status_change', 're_routed', 'closed', 'escalated']);
  });

  test('status, category and priority equal the shared contract', () => {
    expect(values(ComplaintStatus)).toEqual([...ENUMS.ComplaintStatus]);
    expect(values(Category)).toEqual([...ENUMS.Category]);
    expect(values(Priority)).toEqual([...ENUMS.Priority]);
  });
});

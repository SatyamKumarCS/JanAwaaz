// Append-only access to status_history (FR-5.4, NFR-AUDIT). The repository deliberately
// exposes no update or delete operation.
import type { Prisma, PrismaClient, StatusHistory } from '../generated/prisma/client';

export type StatusHistoryInput = Prisma.StatusHistoryUncheckedCreateInput;

export interface StatusHistoryRepository {
  append(entry: StatusHistoryInput): Promise<StatusHistory>;
  listForComplaint(complaintId: number): Promise<StatusHistory[]>;
}

export function createStatusHistoryRepository(
  prisma: Pick<PrismaClient, 'statusHistory'>,
): StatusHistoryRepository {
  return Object.freeze({
    append: (entry: StatusHistoryInput) => prisma.statusHistory.create({ data: entry }),
    listForComplaint: (complaintId: number) =>
      prisma.statusHistory.findMany({
        where: { complaint_id: complaintId },
        orderBy: [{ changed_at: 'asc' }, { id: 'asc' }],
      }),
  });
}

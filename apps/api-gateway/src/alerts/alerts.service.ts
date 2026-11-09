import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Alert as AlertRow } from '@prisma/client';
import type { DomainEvent } from '@project/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { acknowledgeAlert, closeAlert, type ClosingResult } from './alert-closing';
import { applyDomainEvent, type JournalChange } from './alert-journal';
import type { AlertRecord } from './alert-record';

export interface AlertChange {
  readonly previous: AlertRecord | null;
  readonly next: AlertRecord;
  readonly change: Exclude<JournalChange, 'unchanged'>;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Met à jour le journal avec un événement de domaine ; renvoie le changement, ou null s'il n'y en a pas. */
  async applyEvent(event: DomainEvent): Promise<AlertChange | null> {
    const alertId = event.payload.alertId;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.alert.findUnique({ where: { id: alertId } });
      const previous = row ? toRecord(row) : null;
      const { next, change } = applyDomainEvent(previous, event);
      if (!next || change === 'unchanged') return null;
      const data = {
        reason: next.reason,
        status: next.status,
        severity: next.severity,
        escalationCause: next.escalationCause,
        cancellationCause: next.cancellationCause,
        triggeringEventIds: next.triggeringEventIds,
        resolvedAt: next.resolvedAt,
      };
      await tx.alert.upsert({
        where: { id: next.id },
        create: { id: next.id, seniorId: next.seniorId, createdAt: next.createdAt, ...data },
        update: data,
      });
      this.logger.log(`alerte ${next.id} : ${change} (${next.status}${next.severity ? `/${next.severity}` : ''})`);
      return { previous, next, change };
    });
  }

  async list(seniorId: string, page: number, pageSize: number): Promise<{ items: AlertRecord[]; total: number }> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({ where: { seniorId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.alert.count({ where: { seniorId } }),
    ]);
    return { items: rows.map(toRecord), total };
  }

  async recent(seniorId: string, take = 20): Promise<AlertRecord[]> {
    const rows = await this.prisma.alert.findMany({ where: { seniorId }, orderBy: { createdAt: 'desc' }, take });
    return rows.map(toRecord);
  }

  async get(seniorId: string, alertId: string): Promise<AlertRecord> {
    const row = await this.prisma.alert.findFirst({ where: { id: alertId, seniorId } });
    if (!row) throw new NotFoundException('Alerte introuvable');
    return toRecord(row);
  }

  /** Prise en charge par le médical : renseigne acknowledgedAt (idempotent). */
  acknowledge(seniorId: string, alertId: string, personId: string): Promise<AlertChange | null> {
    return this.applyMedicalAction(seniorId, alertId, (alert, now) => acknowledgeAlert(alert, personId, now));
  }

  /** Clôture par le médical après intervention (alerte escaladée uniquement). */
  close(seniorId: string, alertId: string, personId: string): Promise<AlertChange | null> {
    return this.applyMedicalAction(seniorId, alertId, (alert, now) => closeAlert(alert, personId, now));
  }

  private async applyMedicalAction(
    seniorId: string,
    alertId: string,
    action: (alert: AlertRecord, now: Date) => ClosingResult,
  ): Promise<AlertChange | null> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.alert.findFirst({ where: { id: alertId, seniorId } });
      if (!row) throw new NotFoundException('Alerte introuvable');
      const current = toRecord(row);
      const result = action(current, new Date());
      if (!result.ok) {
        throw new ConflictException(
          result.refusal === 'ALREADY_RESOLVED'
            ? 'Alerte déjà résolue'
            : "Seule une alerte escaladée se clôture ; la levée de doute en cours est gérée par la détection",
        );
      }
      if (!result.changed) return null;
      const next = result.next;
      await tx.alert.update({
        where: { id: alertId },
        data: {
          status: next.status,
          resolvedAt: next.resolvedAt,
          acknowledgedAt: next.acknowledgedAt,
          acknowledgedById: next.acknowledgedById,
          closedAt: next.closedAt,
          closedById: next.closedById,
        },
      });
      this.logger.log(`alerte ${alertId} : ${next.closedAt ? 'clôturée' : 'prise en charge'} par ${next.closedById ?? next.acknowledgedById}`);
      return { previous: current, next, change: 'updated' as const };
    });
  }
}

export function toRecord(row: AlertRow): AlertRecord {
  return {
    id: row.id,
    seniorId: row.seniorId,
    reason: row.reason,
    status: row.status,
    severity: row.severity,
    escalationCause: row.escalationCause,
    cancellationCause: row.cancellationCause,
    triggeringEventIds: row.triggeringEventIds,
    createdAt: row.createdAt,
    acknowledgedAt: row.acknowledgedAt,
    acknowledgedById: row.acknowledgedById,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    closedById: row.closedById,
  };
}

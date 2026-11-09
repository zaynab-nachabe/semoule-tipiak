// Remise des notifications aux personnes (ADR 0008) : le service de notification décide des rôles,
// l'API résout les personnes (relations consenties) et tient leur boîte de réception.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Notification as NotificationRow } from '@prisma/client';
import type { NotificationRequested, NotificationView } from '@project/shared-types';
import { recipientIdsForRole } from '../access/access';
import { PrismaService } from '../prisma/prisma.service';

export interface DeliveredNotification {
  readonly recipientId: string;
  readonly view: NotificationView;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Crée une notification par destinataire ; renvoie celles qui sont nouvelles (un doublon QoS 1 est ignoré). */
  async deliver(notification: NotificationRequested): Promise<DeliveredNotification[]> {
    const p = notification.payload;
    const links = await this.prisma.careRelationship.findMany({ where: { seniorId: notification.seniorId } });
    const recipients = recipientIdsForRole(p.recipientRole, links);
    if (recipients.length === 0) {
      this.logger.warn(`notification ${notification.eventId} : aucun destinataire ${p.recipientRole} pour ${notification.seniorId}`);
      return [];
    }
    const delivered: DeliveredNotification[] = [];
    for (const recipientId of recipients) {
      const existing = await this.prisma.notification.findUnique({
        where: { eventId_recipientId: { eventId: notification.eventId, recipientId } },
      });
      if (existing) continue;
      const row = await this.prisma.notification.create({
        data: {
          eventId: notification.eventId,
          recipientId,
          seniorId: notification.seniorId,
          alertId: p.alertId,
          priority: p.priority,
          severity: p.severity,
          reason: p.reason,
          escalationCause: p.escalationCause,
          title: p.title,
          message: p.message,
          createdAt: new Date(notification.timestamp),
        },
      });
      delivered.push({ recipientId, view: toNotificationView(row) });
    }
    this.logger.log(`notification ${p.priority} « ${p.title} » remise à ${delivered.length} personne(s) (${p.recipientRole})`);
    return delivered;
  }

  async list(recipientId: string, unreadOnly: boolean, page: number, pageSize: number): Promise<{ items: NotificationView[]; total: number }> {
    const where = { recipientId, ...(unreadOnly ? { readAt: null } : {}) };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: rows.map(toNotificationView), total };
  }

  /** Marque comme lue une notification de l'appelant (idempotent) ; celle d'un autre → 404. */
  async markRead(recipientId: string, notificationId: string): Promise<NotificationView> {
    const row = await this.prisma.notification.findFirst({ where: { id: notificationId, recipientId } });
    if (!row) throw new NotFoundException('Notification introuvable');
    if (row.readAt) return toNotificationView(row);
    return toNotificationView(await this.prisma.notification.update({ where: { id: row.id }, data: { readAt: new Date() } }));
  }
}

export function toNotificationView(row: NotificationRow): NotificationView {
  return {
    notificationId: row.id,
    seniorId: row.seniorId,
    alertId: row.alertId,
    priority: row.priority,
    severity: row.severity,
    reason: row.reason,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}

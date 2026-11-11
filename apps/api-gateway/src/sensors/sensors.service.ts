// Registre des capteurs attendus et leur état (ADR 0012). La détection décide de l'état (SensorStatusChanged) ;
// l'API l'enregistre, y ajoute le dernier signal reçu et la batterie (historique), et le montre à l'application.

import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, ExpectedSensor, Role, SensorHealthView } from '@project/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { batteryOf, sortSensors, toExpectedSensor, toSensorHealthView, type SensorActivity, type SensorRow } from './sensor-health';

type SensorStatusChanged = Extract<DomainEvent, { type: 'SensorStatusChanged' }>;

@Injectable()
export class SensorsService {
  private readonly logger = new Logger(SensorsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Capteurs du senior et leur état, projetés selon le rôle. */
  async list(seniorId: string, role: Role): Promise<SensorHealthView[]> {
    const rows = sortSensors(await this.prisma.sensor.findMany({ where: { seniorId } }));
    return Promise.all(rows.map(async (row) => toSensorHealthView(row, await this.activityOf(seniorId, row.id), role)));
  }

  /** Capteurs attendus, pour le profil d'activité envoyé à la détection. */
  async expected(seniorId: string): Promise<ExpectedSensor[]> {
    return sortSensors(await this.prisma.sensor.findMany({ where: { seniorId } })).map(toExpectedSensor);
  }

  /**
   * Nouvel état publié par la détection. Renvoie la ligne mise à jour (pour le temps réel), ou null si le
   * capteur est inconnu du registre (registre de Node-RED et de l'API désaccordés : limite connue).
   */
  async applyStatus(event: SensorStatusChanged): Promise<SensorRow | null> {
    const p = event.payload;
    const row = await this.prisma.sensor.findFirst({ where: { id: p.sensorId, seniorId: event.seniorId } });
    if (!row) {
      this.logger.warn(`état reçu pour un capteur inconnu : ${p.sensorId} (${event.seniorId})`);
      return null;
    }
    const updated = await this.prisma.sensor.update({
      where: { id: row.id },
      data: { status: p.status, statusChangedAt: new Date(event.timestamp) },
    });
    this.logger.log(`capteur ${p.sensorId} : ${p.status}`);
    return updated;
  }

  /** Vue d'un capteur pour un rôle, avec son dernier signal (temps réel). */
  async view(seniorId: string, row: SensorRow, role: Role): Promise<SensorHealthView> {
    return toSensorHealthView(row, await this.activityOf(seniorId, row.id), role);
  }

  private async activityOf(seniorId: string, sensorId: string): Promise<SensorActivity> {
    const [last, heartbeat] = await Promise.all([
      this.prisma.signalRecord.findFirst({ where: { seniorId, sensorId }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
      this.prisma.signalRecord.findFirst({
        where: { seniorId, sensorId, type: 'SENSOR_HEARTBEAT' },
        orderBy: { timestamp: 'desc' },
        select: { payload: true },
      }),
    ]);
    return { lastSeenAt: last?.timestamp ?? null, battery: heartbeat ? batteryOf(heartbeat.payload) : null };
  }
}

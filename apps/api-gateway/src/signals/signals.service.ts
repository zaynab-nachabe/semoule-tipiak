// Historique des signaux normalisés (décision D3 : l'API s'abonne à signals/# et les enregistre).

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RawSignal } from '@project/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import type { SignalSnapshot } from '../seniors/senior-status';

/** Types dont le payload est une mesure { value, unit }, exposés dans /measurements. */
export const MEASURABLE_TYPES = ['HEART_RATE', 'FALL_IMPACT', 'SENSOR_HEARTBEAT'] as const;
export type MeasurableType = (typeof MEASURABLE_TYPES)[number];

@Injectable()
export class SignalsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Enregistre un signal ; un doublon (même eventId, QoS 1) est ignoré. */
  async record(signal: RawSignal): Promise<boolean> {
    const result = await this.prisma.signalRecord.createMany({
      data: [
        {
          eventId: signal.eventId,
          seniorId: signal.seniorId,
          sensorId: signal.sensorId,
          type: signal.type,
          timestamp: new Date(signal.timestamp),
          payload: signal.payload as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    return result.count === 1;
  }

  async lastPresence(seniorId: string): Promise<SignalSnapshot | null> {
    return this.prisma.signalRecord.findFirst({
      where: { seniorId, type: { in: ['PIR_MOTION', 'PRESSURE_PLATE'] } },
      orderBy: { timestamp: 'desc' },
      select: { type: true, timestamp: true, payload: true },
    });
  }

  async lastOfType(seniorId: string, type: MeasurableType): Promise<SignalSnapshot | null> {
    return this.prisma.signalRecord.findFirst({
      where: { seniorId, type },
      orderBy: { timestamp: 'desc' },
      select: { type: true, timestamp: true, payload: true },
    });
  }

  async measurements(
    seniorId: string,
    type: MeasurableType,
    range: { from?: Date; to?: Date },
    page: number,
    pageSize: number,
  ): Promise<{ items: SignalSnapshot[]; total: number }> {
    const where: Prisma.SignalRecordWhereInput = {
      seniorId,
      type,
      ...(range.from || range.to ? { timestamp: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.signalRecord.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { type: true, timestamp: true, payload: true },
      }),
      this.prisma.signalRecord.count({ where }),
    ]);
    return { items, total };
  }
}

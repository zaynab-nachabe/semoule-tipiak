// Profils d'activité (ADR 0010 à 0012) : seuils d'inactivité (modifiés par l'équipe médicale), absence
// en cours (déclarée par le senior) et capteurs attendus. Chaque modification est publiée sur profiles/{seniorId} : la détection
// l'applique sans relire la base.

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Topics, type ActivityProfile, type ActivityProfileUpdated, type ToleranceThreshold } from '@project/shared-types';
import { randomUUID } from 'node:crypto';
import { toAbsenceView } from '../absence/absence';
import { sortSensors, toExpectedSensor, type SensorRow } from '../sensors/sensor-health';
import { EventIngestionService } from '../events/event-ingestion.service';
import { PrismaService } from '../prisma/prisma.service';
import { toActivityProfile, toRow } from './activity-profile';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventIngestionService,
  ) {}

  async get(seniorId: string): Promise<ActivityProfile> {
    const senior = await this.prisma.senior.findUnique({ where: { id: seniorId }, include: this.include(new Date()) });
    if (!senior) throw new NotFoundException('Senior introuvable');
    return this.toProfile(senior);
  }

  /** Tous les profils, pour le chargement initial de la détection. */
  async all(): Promise<ActivityProfile[]> {
    const seniors = await this.prisma.senior.findMany({ include: this.include(new Date()), orderBy: { id: 'asc' } });
    return seniors.map((s) => this.toProfile(s));
  }

  /** Remplace tous les seuils du senior, puis publie le profil complet. */
  async replace(seniorId: string, thresholds: readonly ToleranceThreshold[]): Promise<ActivityProfile> {
    const senior = await this.prisma.senior.findUnique({ where: { id: seniorId } });
    if (!senior) throw new NotFoundException('Senior introuvable');
    await this.prisma.$transaction([
      this.prisma.toleranceThreshold.deleteMany({ where: { seniorId } }),
      this.prisma.toleranceThreshold.createMany({ data: thresholds.map((t) => toRow(seniorId, t)) }),
    ]);
    const profile = await this.publish(seniorId);
    this.logger.log(`seuils d'inactivité de ${seniorId} modifiés (${profile.thresholds.length})`);
    return profile;
  }

  /** Publie le profil complet et à jour sur profiles/{seniorId} (seuils modifiés, absence déclarée ou terminée). */
  async publish(seniorId: string): Promise<ActivityProfile> {
    const profile = await this.get(seniorId);
    const message: ActivityProfileUpdated = {
      eventId: randomUUID(),
      seniorId,
      type: 'ActivityProfileUpdated',
      timestamp: new Date().toISOString(),
      payload: profile,
    };
    this.events.publish(Topics.profile(seniorId), message);
    return profile;
  }

  /** Seuils et absence en cours (la plus récente, ni terminée ni dépassée). */
  private include(now: Date) {
    return {
      thresholds: true,
      sensors: true,
      absences: { where: { endedAt: null, expectedReturnAt: { gt: now } }, orderBy: { startedAt: 'desc' as const }, take: 1 },
    };
  }

  private toProfile(senior: Parameters<typeof toActivityProfile>[0] & {
    thresholds: Parameters<typeof toActivityProfile>[1];
    absences: { startedAt: Date; expectedReturnAt: Date; endedAt: Date | null }[];
    sensors: SensorRow[];
  }): ActivityProfile {
    const absence = senior.absences[0];
    const sensors = sortSensors(senior.sensors).map(toExpectedSensor);
    return toActivityProfile(senior, senior.thresholds, absence ? toAbsenceView(absence) : null, sensors);
  }
}

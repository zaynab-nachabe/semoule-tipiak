// Absence déclarée par le senior (ADR 0011) : enregistrée en base, puis transmise à la détection dans le
// profil d'activité (profiles/{seniorId}) et à l'application en temps réel (absence.changed).

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { AbsenceEnd } from '@prisma/client';
import type { AbsenceView, RawSignal } from '@project/shared-types';
import { API_CONFIG, type ApiConfig } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesService } from '../profiles/profiles.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { endsOnActivity, toAbsenceView } from './absence';

@Injectable()
export class AbsenceService {
  private readonly logger = new Logger(AbsenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(forwardRef(() => ProfilesService)) private readonly profiles: ProfilesService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Absence en cours du senior, ou null. */
  async current(seniorId: string, now: Date = new Date()): Promise<AbsenceView | null> {
    const row = await this.ongoing(seniorId, now);
    return row ? toAbsenceView(row) : null;
  }

  /** « Je m'absente » : remplace une absence en cours, puis prévient la détection et l'application. */
  async declare(seniorId: string, until: Date): Promise<AbsenceView> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.absence.updateMany({ where: { seniorId, endedAt: null, expectedReturnAt: { gt: now } }, data: { endedAt: now, endReason: 'REPLACED' } }),
      this.prisma.absence.create({ data: { seniorId, startedAt: now, expectedReturnAt: until } }),
    ]);
    const view: AbsenceView = { since: now.toISOString(), until: until.toISOString() };
    this.logger.log(`absence de ${seniorId} jusqu'à ${view.until}`);
    await this.changed(seniorId, view);
    return view;
  }

  /** Fin de l'absence en cours (« je suis rentré(e) » ou mouvement au domicile). Sans absence en cours : rien. */
  async end(seniorId: string, reason: AbsenceEnd): Promise<void> {
    const now = new Date();
    const { count } = await this.prisma.absence.updateMany({
      where: { seniorId, endedAt: null, expectedReturnAt: { gt: now } },
      data: { endedAt: now, endReason: reason },
    });
    if (count === 0) return;
    this.logger.log(`fin de l'absence de ${seniorId} (${reason})`);
    await this.changed(seniorId, null);
  }

  /** Signal reçu du domicile : un mouvement après le délai de départ met fin à l'absence (ADR 0011). */
  async onSignal(signal: RawSignal): Promise<void> {
    if (signal.type !== 'PIR_MOTION' && signal.type !== 'PRESSURE_PLATE') return;
    const at = new Date(signal.timestamp);
    const row = await this.ongoing(signal.seniorId, at);
    if (row && endsOnActivity(row, at, this.config.absenceGraceMs)) {
      await this.end(signal.seniorId, 'ACTIVITY_AT_HOME');
    }
  }

  private ongoing(seniorId: string, now: Date) {
    return this.prisma.absence.findFirst({
      where: { seniorId, endedAt: null, expectedReturnAt: { gt: now } },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async changed(seniorId: string, absence: AbsenceView | null): Promise<void> {
    await this.profiles.publish(seniorId);
    this.realtime.publishAbsence({ seniorId, absence });
  }
}

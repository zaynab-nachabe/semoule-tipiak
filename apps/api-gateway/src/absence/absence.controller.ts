import { Body, Controller, Delete, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { AbsenceView } from '@project/shared-types';
import { AccessService } from '../access/access.service';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.service';
import { parseReturnTime } from './absence';
import { AbsenceService } from './absence.service';

/** « Je m'absente » / « je suis rentré(e) » : le senior seulement (ADR 0011). */
@Controller('seniors/:seniorId/absence')
@UseGuards(AuthGuard)
export class AbsenceController {
  constructor(
    private readonly access: AccessService,
    private readonly absences: AbsenceService,
  ) {}

  /** Déclare une absence jusqu'au retour prévu (corps AbsenceRequest) ; remplace une absence en cours. */
  @Post()
  @HttpCode(201)
  async declare(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string, @Body() body: unknown): Promise<AbsenceView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'DECLARE_ABSENCE');
    return this.absences.declare(seniorId, parseReturnTime(body, new Date()));
  }

  /** « Je suis rentré(e) » : fin de l'absence en cours (idempotent). */
  @Delete()
  @HttpCode(204)
  async end(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string): Promise<void> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'DECLARE_ABSENCE');
    await this.absences.end(seniorId, 'RETURNED');
  }
}

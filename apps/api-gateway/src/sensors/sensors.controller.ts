import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { SensorHealthView } from '@project/shared-types';
import { AccessService } from '../access/access.service';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.service';
import { SensorsService } from './sensors.service';

/** État des capteurs d'un senior (ADR 0012) : détaillé pour le médical, simplifié pour la famille et le senior. */
@Controller('seniors/:seniorId/sensors')
@UseGuards(AuthGuard)
export class SensorsController {
  constructor(
    private readonly access: AccessService,
    private readonly sensors: SensorsService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string): Promise<SensorHealthView[]> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    return this.sensors.list(seniorId, ctx.role);
  }
}

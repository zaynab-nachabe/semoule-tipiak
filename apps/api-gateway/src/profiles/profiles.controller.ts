import { Body, CanActivate, Controller, ExecutionContext, Get, Inject, Injectable, Param, Put, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SERVICE_TOKEN_HEADER, type ActivityProfile } from '@project/shared-types';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AccessService } from '../access/access.service';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.service';
import { API_CONFIG, type ApiConfig } from '../config';
import { parseThresholds } from './activity-profile';
import { ProfilesService } from './profiles.service';

/** Seuils d'inactivité d'un senior : lecture et modification par l'équipe médicale (contrat §3). */
@Controller('seniors/:seniorId/thresholds')
@UseGuards(AuthGuard)
export class ThresholdsController {
  constructor(
    private readonly access: AccessService,
    private readonly profiles: ProfilesService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string): Promise<ActivityProfile> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'MANAGE_THRESHOLDS');
    return this.profiles.get(seniorId);
  }

  /** Remplace tous les seuils ; la détection reçoit le nouveau profil par message (profiles/{seniorId}). */
  @Put()
  async replace(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string, @Body() body: unknown): Promise<ActivityProfile> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'MANAGE_THRESHOLDS');
    return this.profiles.replace(seniorId, parseThresholds(body));
  }
}

/** Réservé aux services internes : la clé partagée (SERVICE_TOKEN) doit figurer dans l'en-tête x-service-token. */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const given = context.switchToHttp().getRequest<Request>().headers[SERVICE_TOKEN_HEADER];
    if (typeof given !== 'string' || !sameSecret(given, this.config.serviceToken)) {
      throw new UnauthorizedException('Clé de service manquante ou invalide');
    }
    return true;
  }
}

export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Point d'accès de la détection : tous les profils, lus au démarrage (ADR 0010). */
@Controller('internal')
@UseGuards(ServiceTokenGuard)
export class InternalController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get('activity-profiles')
  all(): Promise<ActivityProfile[]> {
    return this.profiles.all();
  }
}

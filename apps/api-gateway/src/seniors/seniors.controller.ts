import { BadRequestException, ConflictException, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { ActionAcceptedView, AlertView, MeasurementPointView, Paginated, SeniorStatusView } from '@project/shared-types';
import { AbsenceService } from '../absence/absence.service';
import { AccessService } from '../access/access.service';
import { IngestionClient } from '../actions/ingestion-client';
import { AlertsService } from '../alerts/alerts.service';
import { toAlertView } from '../alerts/alert-view';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.service';
import { parseDate, parsePage } from '../common/pagination';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { MEASURABLE_TYPES, SignalsService, type MeasurableType } from '../signals/signals.service';
import { deriveSeniorStatus, toMeasurementPoint } from './senior-status';

@Controller('seniors/:seniorId')
@UseGuards(AuthGuard)
export class SeniorsController {
  constructor(
    private readonly access: AccessService,
    private readonly alerts: AlertsService,
    private readonly signals: SignalsService,
    private readonly realtime: RealtimeGateway,
    private readonly ingestion: IngestionClient,
    private readonly absences: AbsenceService,
  ) {}

  @Get('status')
  async status(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string): Promise<SeniorStatusView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    const [recentAlerts, lastPresence, lastHeartRate, absence] = await Promise.all([
      this.alerts.recent(seniorId),
      this.signals.lastPresence(seniorId),
      this.signals.lastOfType(seniorId, 'HEART_RATE'),
      this.absences.current(seniorId),
    ]);
    return deriveSeniorStatus({ seniorId, recentAlerts, lastPresence, lastHeartRate, absence }, ctx.role);
  }

  @Get('alerts')
  async alertList(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seniorId') seniorId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Paginated<AlertView>> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    const request = parsePage(page, pageSize);
    const { items, total } = await this.alerts.list(seniorId, request.page, request.pageSize);
    return { items: items.map((a) => toAlertView(a, ctx.role)), total, ...request };
  }

  @Get('alerts/:alertId')
  async alert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
  ): Promise<AlertView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    return toAlertView(await this.alerts.get(seniorId, alertId), ctx.role);
  }

  /** Prise en charge d'une alerte par l'équipe médicale. */
  @Post('alerts/:alertId/acknowledge')
  @HttpCode(200)
  async acknowledge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
  ): Promise<AlertView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'ACKNOWLEDGE_ALERT');
    const change = await this.alerts.acknowledge(seniorId, alertId, user.personId);
    if (change) await this.realtime.publishAlertChange(change);
    return toAlertView(change?.next ?? (await this.alerts.get(seniorId, alertId)), ctx.role);
  }

  /** Clôture d'une alerte escaladée par l'équipe médicale, après intervention. */
  @Post('alerts/:alertId/close')
  @HttpCode(200)
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
  ): Promise<AlertView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'CLOSE_ALERT');
    const change = await this.alerts.close(seniorId, alertId, user.personId);
    if (change) await this.realtime.publishAlertChange(change);
    return toAlertView(change?.next ?? (await this.alerts.get(seniorId, alertId)), ctx.role);
  }

  /**
   * « Tout va bien » (senior) : annule une levée de doute en cours. L'action passe par l'ingestion (ADR 0007) ;
   * le résultat (alerte annulée) arrive ensuite en temps réel. Après l'escalade, l'annulation n'a plus d'effet → 409.
   */
  @Post('alerts/:alertId/cancel')
  @HttpCode(202)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seniorId') seniorId: string,
    @Param('alertId') alertId: string,
  ): Promise<ActionAcceptedView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'CANCEL_ALERT');
    const alert = await this.alerts.get(seniorId, alertId);
    if (alert.status !== 'PRE_CONFIRMING') {
      throw new ConflictException("La levée de doute est terminée : l'alerte ne peut plus être annulée");
    }
    return this.ingestion.send(seniorId, { kind: 'CANCEL_ALERT', alertId });
  }

  /** « J'ai besoin d'aide » (senior) : même effet que le bouton d'aide de la montre (ADR 0005, 0007). */
  @Post('help')
  @HttpCode(202)
  async help(@CurrentUser() user: AuthenticatedUser, @Param('seniorId') seniorId: string): Promise<ActionAcceptedView> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'REQUEST_HELP');
    return this.ingestion.send(seniorId, { kind: 'HELP_BUTTON' });
  }

  /** Mesures brutes (médical uniquement) : ?type=HEART_RATE&from=…&to=… */
  @Get('measurements')
  async measurements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('seniorId') seniorId: string,
    @Query('type') type?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Paginated<MeasurementPointView>> {
    const ctx = await this.access.assertCanAccess(user.personId, seniorId);
    this.access.assertCapability(ctx, 'READ_MEASUREMENTS');
    const measurable = MEASURABLE_TYPES as readonly string[];
    if (!type || !measurable.includes(type)) {
      throw new BadRequestException(`type doit être l'un de : ${MEASURABLE_TYPES.join(', ')}`);
    }
    const request = parsePage(page, pageSize);
    const range = { from: parseDate('from', from), to: parseDate('to', to) };
    const { items, total } = await this.signals.measurements(
      seniorId,
      type as MeasurableType,
      { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) },
      request.page,
      request.pageSize,
    );
    const points = items.map(toMeasurementPoint).filter((p): p is MeasurementPointView => p !== null);
    return { items: points, total, ...request };
  }
}

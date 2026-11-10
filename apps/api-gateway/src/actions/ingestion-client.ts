// Transmission des actions du senior à l'ingestion (ADR 0007) : application → API → Node-RED → signal.
// L'API a déjà vérifié les droits ; Node-RED normalise l'action en signal CANCEL_ALERT ou HELP_BUTTON,
// exactement comme un appui sur la montre. La détection ne voit pas la différence.

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { APP_INGEST_ROUTE, appSourceId, type ActionAcceptedView } from '@project/shared-types';
import { API_CONFIG, type ApiConfig } from '../config';

/** Corps accepté par POST /ingest/app (services/ingestion/README.md). */
export interface AppActionBody {
  sensorId: string;
  event: 'CANCEL_ALERT' | 'HELP_BUTTON';
  alertId?: string;
}

export type SeniorAction = { kind: 'CANCEL_ALERT'; alertId: string } | { kind: 'HELP_BUTTON' };

export function toAppActionBody(seniorId: string, action: SeniorAction): AppActionBody {
  return action.kind === 'CANCEL_ALERT'
    ? { sensorId: appSourceId(seniorId), event: 'CANCEL_ALERT', alertId: action.alertId }
    : { sensorId: appSourceId(seniorId), event: 'HELP_BUTTON' };
}

const TIMEOUT_MS = 5_000;

@Injectable()
export class IngestionClient {
  private readonly logger = new Logger(IngestionClient.name);

  constructor(@Inject(API_CONFIG) private readonly config: ApiConfig) {}

  /** Envoie l'action à Node-RED ; 503 si l'ingestion ne répond pas ou refuse le message. */
  async send(seniorId: string, action: SeniorAction): Promise<ActionAcceptedView> {
    const body = toAppActionBody(seniorId, action);
    let response: Response;
    try {
      response = await fetch(`${this.config.nodeRedUrl}${APP_INGEST_ROUTE}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(`ingestion injoignable (${action.kind}, ${seniorId}) : ${(error as Error).message}`);
      throw new ServiceUnavailableException("L'action n'a pas pu être transmise : service d'ingestion indisponible");
    }
    const answer = (await response.json().catch(() => null)) as { accepted?: boolean; eventId?: string; details?: string } | null;
    if (response.status !== 202 || !answer?.accepted || typeof answer.eventId !== 'string') {
      // 422 : registre sans source « application » pour ce senior, ou message refusé.
      this.logger.error(`ingestion a refusé ${action.kind} pour ${seniorId} (HTTP ${response.status}) : ${answer?.details ?? 'réponse inattendue'}`);
      throw new ServiceUnavailableException("L'action n'a pas pu être transmise : refusée par le service d'ingestion");
    }
    this.logger.log(`${action.kind} transmis pour ${seniorId} (signal ${answer.eventId})`);
    return { eventId: answer.eventId };
  }
}

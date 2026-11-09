import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { EventIngestionService } from '../events/event-ingestion.service';
import { PrismaService } from '../prisma/prisma.service';

/** État de l'API pour le healthcheck Docker : la base doit répondre ; l'état MQTT est indiqué. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventIngestionService,
  ) {}

  @Get()
  async health(): Promise<{ status: 'ok'; database: 'up'; mqtt: 'connected' | 'disconnected' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Base de données injoignable');
    }
    return { status: 'ok', database: 'up', mqtt: this.events.isConnected ? 'connected' : 'disconnected' };
  }
}

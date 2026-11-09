import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessService } from './access/access.service';
import { AlertsService } from './alerts/alerts.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { API_CONFIG, loadConfig } from './config';
import { EventIngestionService } from './events/event-ingestion.service';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { SeniorsController } from './seniors/seniors.controller';
import { SignalsService } from './signals/signals.service';

const config = loadConfig();

@Module({
  imports: [JwtModule.register({ secret: config.jwtSecret, signOptions: { expiresIn: config.jwtExpiresIn as `${number}h` } })],
  controllers: [AuthController, SeniorsController, HealthController],
  providers: [
    { provide: API_CONFIG, useValue: config },
    PrismaService,
    AccessService,
    AuthService,
    AuthGuard,
    AlertsService,
    SignalsService,
    RealtimeGateway,
    EventIngestionService,
  ],
})
export class AppModule {}

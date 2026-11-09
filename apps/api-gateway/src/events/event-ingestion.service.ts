// Abonnements MQTT de l'API (docs/topics-mqtt.md §3) :
//   alerts/#   événements de domaine -> journal des alertes + temps réel
//   signals/#        signaux normalisés     -> historique (décision D3)
//   notifications/+  notifications par rôle -> boîte de réception de chaque destinataire + temps réel (ADR 0008)
// Session persistante (identifiant fixe) : les messages reçus pendant un redémarrage sont remis ensuite.

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Ajv from 'ajv';
import { connect, type MqttClient } from 'mqtt';
import { MQTT_QOS, Subscriptions, type DomainEvent, type NotificationRequested, type RawSignal } from '@project/shared-types';
import domainEventSchema from '@project/shared-types/schemas/domain-event.schema.json';
import notificationSchema from '@project/shared-types/schemas/notification.schema.json';
import rawSignalSchema from '@project/shared-types/schemas/raw-signal.schema.json';
import { AlertsService } from '../alerts/alerts.service';
import { RecentIds } from '../common/recent-ids';
import { API_CONFIG, type ApiConfig } from '../config';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { SignalsService } from '../signals/signals.service';

const ajv = new Ajv({ strict: true, allErrors: true });
const validateEvent = ajv.compile<DomainEvent>(domainEventSchema);
const validateSignal = ajv.compile<RawSignal>(rawSignalSchema);
const validateNotification = ajv.compile<NotificationRequested>(notificationSchema);

@Injectable()
export class EventIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventIngestionService.name);
  private readonly recentEvents = new RecentIds();
  private client: MqttClient | null = null;
  private connected = false;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly alerts: AlertsService,
    private readonly signals: SignalsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  onModuleInit(): void {
    const client = connect(this.config.mqttUrl, { clientId: this.config.mqttClientId, clean: false, reconnectPeriod: 2_000 });
    this.client = client;
    client.on('connect', () => {
      this.connected = true;
      client.subscribe([Subscriptions.apiGateway, Subscriptions.history, Subscriptions.apiNotifications], { qos: MQTT_QOS }, (error) => {
        if (error) this.logger.error(`abonnement impossible : ${error.message}`);
        else this.logger.log(`connecté à ${this.config.mqttUrl}, abonné à ${Subscriptions.apiGateway}, ${Subscriptions.history} et ${Subscriptions.apiNotifications}`);
      });
    });
    client.on('close', () => (this.connected = false));
    client.on('error', (error) => this.logger.error(`erreur MQTT : ${error.message}`));
    client.on('message', (topic, payload) => {
      void this.handle(topic, payload).catch((error: unknown) =>
        this.logger.error(`traitement impossible (${topic}) : ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.endAsync();
  }

  async handle(topic: string, payload: Buffer): Promise<void> {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString('utf8'));
    } catch {
      this.logger.warn(`message ignoré (JSON invalide) sur ${topic}`);
      return;
    }

    if (topic.startsWith('signals/')) {
      if (!validateSignal(data)) {
        this.logger.warn(`signal ignoré (non conforme) sur ${topic}`);
        return;
      }
      await this.signals.record(data);
      return;
    }

    if (topic.startsWith('alerts/')) {
      if (!validateEvent(data)) {
        this.logger.warn(`événement ignoré (non conforme) sur ${topic}`);
        return;
      }
      if (!this.recentEvents.remember(data.eventId)) return; // doublon QoS 1
      const change = await this.alerts.applyEvent(data);
      if (data.type === 'PreConfirmationRequested') {
        await this.realtime.publishPreConfirmation(data.seniorId, data.payload);
      }
      if (change) await this.realtime.publishAlertChange(change);
      return;
    }

    if (topic.startsWith('notifications/')) {
      if (!validateNotification(data)) {
        this.logger.warn(`notification ignorée (non conforme) sur ${topic}`);
        return;
      }
      // Pas de mémoire des doublons ici : la contrainte unique (eventId, destinataire) en base suffit.
      const delivered = await this.notifications.deliver(data);
      this.realtime.publishNotifications(delivered);
    }
  }
}

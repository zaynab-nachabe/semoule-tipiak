// Abonnements MQTT de l'API (docs/topics-mqtt.md §3) :
//   alerts/#   événements de domaine -> journal des alertes + temps réel ; état des capteurs (ADR 0012)
//   signals/#        signaux normalisés     -> historique (décision D3) ; un mouvement peut terminer une absence (ADR 0011)
//   notifications/+  notifications par rôle -> boîte de réception de chaque destinataire + temps réel (ADR 0008)
// Session persistante (identifiant fixe) : les messages reçus pendant un redémarrage sont remis ensuite.

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import Ajv from 'ajv';
import { connect, type MqttClient } from 'mqtt';
import { MQTT_QOS, Subscriptions, type DomainEvent, type NotificationRequested, type RawSignal } from '@project/shared-types';
import domainEventSchema from '@project/shared-types/schemas/domain-event.schema.json';
import notificationSchema from '@project/shared-types/schemas/notification.schema.json';
import rawSignalSchema from '@project/shared-types/schemas/raw-signal.schema.json';
import { AbsenceService } from '../absence/absence.service';
import { AlertsService } from '../alerts/alerts.service';
import { RecentIds } from '../common/recent-ids';
import { API_CONFIG, type ApiConfig } from '../config';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { SensorsService } from '../sensors/sensors.service';
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
    @Inject(forwardRef(() => AbsenceService)) private readonly absences: AbsenceService,
    private readonly sensors: SensorsService,
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

  /**
   * Publie un message (QoS 1, sans retain) sans attendre l'accusé : hors connexion, mqtt.js le garde et
   * l'envoie à la reconnexion. Une erreur est seulement journalisée (limite connue, ADR 0010).
   */
  publish(topic: string, message: unknown): void {
    if (!this.client) {
      this.logger.error(`publication impossible sur ${topic} : client MQTT non démarré`);
      return;
    }
    this.client.publish(topic, JSON.stringify(message), { qos: MQTT_QOS, retain: false }, (error) => {
      if (error) this.logger.error(`publication impossible sur ${topic} : ${error.message}`);
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
      await this.absences.onSignal(data);
      return;
    }

    if (topic.startsWith('alerts/')) {
      if (!validateEvent(data)) {
        this.logger.warn(`événement ignoré (non conforme) sur ${topic}`);
        return;
      }
      if (!this.recentEvents.remember(data.eventId)) return; // doublon QoS 1
      if (data.type === 'SensorStatusChanged') {
        // État d'un capteur (niveau 0, ADR 0012) : registre des capteurs, pas journal des alertes.
        const row = await this.sensors.applyStatus(data);
        if (row) await this.realtime.publishSensorChange(data.seniorId, row);
        return;
      }
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

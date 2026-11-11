// Routage des états de capteurs (ADR 0012, risque R1) : qui prévenir quand un capteur se tait ou que sa
// batterie faiblit. Fonctions pures. Niveau 0 (SYSTEM) : ce n'est pas une alerte sur la personne.
//
//   capteur muet        ─► médical INFO ; la montre muette prévient aussi la famille (NORMAL, risque R7)
//   batterie faible     ─► médical INFO
//   de nouveau en ligne ─► personne (l'état est visible dans les vues)

import type { DomainEvent, NotificationPriority, RecipientRole, SensorKind } from '@project/shared-types';

export type SensorStatusEvent = Extract<DomainEvent, { type: 'SensorStatusChanged' }>;

export interface RoutedSensorNotification {
  readonly recipientRole: RecipientRole;
  readonly priority: NotificationPriority;
  readonly title: string;
  readonly message: string;
}

const KIND_LABEL: Record<SensorKind, string> = {
  PIR: 'détecteur de mouvement',
  PRESSURE_PLATE: 'bande de pression',
  WATCH: 'montre',
};

export function routeSensorStatus(payload: SensorStatusEvent['payload']): RoutedSensorNotification[] {
  const name = `${KIND_LABEL[payload.kind]} ${payload.sensorId}`;
  if (payload.status === 'OFFLINE') {
    if (payload.kind === 'WATCH') {
      const message =
        "La montre ne donne plus de nouvelles : elle est peut-être déchargée, retirée ou loin du téléphone. Les chutes ne sont plus détectées tant qu'elle ne transmet pas.";
      return [
        { recipientRole: 'FAMILY', priority: 'NORMAL', title: 'La montre ne transmet plus', message },
        { recipientRole: 'MEDICAL', priority: 'INFO', title: 'La montre ne transmet plus', message },
      ];
    }
    return [
      {
        recipientRole: 'MEDICAL',
        priority: 'INFO',
        title: `Capteur muet : ${name}`,
        message: "Ce capteur n'envoie plus rien depuis plus longtemps que prévu (pile, réseau Zigbee). Tant qu'il est muet, la surveillance de cette pièce est aveugle.",
      },
    ];
  }
  if (payload.status === 'LOW_BATTERY') {
    const level = payload.battery ? ` (${payload.battery.value} %)` : '';
    return [
      {
        recipientRole: 'MEDICAL',
        priority: 'INFO',
        title: `Batterie faible : ${name}${level}`,
        message: 'Prévoir le remplacement de la pile ou la recharge avant que le capteur ne se taise.',
      },
    ];
  }
  return [];
}

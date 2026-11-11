// Capteurs d'un senior et leur état (ADR 0012) : chargés par REST, mis à jour en temps réel (sensor.changed).

import type { SensorHealthView } from '@project/shared-types';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useRealtimeMessage } from '../api/realtime';
import { upsertSensor } from '../model/sensors';

export function useSensors(seniorId: string) {
  const [sensors, setSensors] = useState<SensorHealthView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SensorHealthView[]>(`/seniors/${seniorId}/sensors`)
      .then((list) => {
        setSensors(list);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [seniorId]);

  useRealtimeMessage('sensor.changed', (message) => {
    if (message.seniorId === seniorId) setSensors((list) => upsertSensor(list, message.sensor));
  });

  return { sensors, error };
}

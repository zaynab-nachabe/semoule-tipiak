import { describe, expect, it, vi } from 'vitest';
import type { ActivityProfile as ActivityProfileData } from '@project/shared-types';
import type { ActivityProfile } from '../src/domain/aggregates/activity-profile.js';
import { silentLogger } from '../src/infrastructure/logger.js';
import { createProfileHandler, fetchProfilesUntilAvailable } from '../src/infrastructure/profiles-adapter.js';

const PROFILE: ActivityProfileData = {
  seniorId: 'senior-001',
  timeZone: 'Europe/Paris',
  thresholds: [{ condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, timeRange: { startTime: '07:00', endTime: '22:00' } }],
  absence: null,
  sensors: [],
};
let n = 0;
const message = (payload: ActivityProfileData = PROFILE, eventId?: string) => {
  n += 1;
  return Buffer.from(
    JSON.stringify({
      eventId: eventId ?? `e5f6a7b8-0000-4000-8000-${String(n).padStart(12, '0')}`,
      seniorId: payload.seniorId,
      type: 'ActivityProfileUpdated',
      timestamp: '2026-01-15T09:00:00.000Z',
      payload,
    }),
  );
};

describe('profils reçus sur profiles/{seniorId}', () => {
  const setup = () => {
    const received: ActivityProfile[] = [];
    const handle = createProfileHandler({ onProfile: (p) => received.push(p), logger: silentLogger });
    return { received, handle };
  };

  it('un profil conforme est transmis au domaine', () => {
    const { received, handle } = setup();
    handle('profiles/senior-001', message());
    expect(received.map((p) => [p.seniorId, p.thresholds.length])).toEqual([['senior-001', 1]]);
  });

  it('ignorés : topic d\'un autre senior, doublon QoS 1, fuseau inconnu, seuil invalide, JSON cassé', () => {
    const { received, handle } = setup();
    handle('profiles/senior-002', message());
    const once = message(PROFILE, 'e5f6a7b8-0000-4000-8000-999999999999');
    handle('profiles/senior-001', once);
    handle('profiles/senior-001', once);
    handle('profiles/senior-001', message({ ...PROFILE, timeZone: 'Mars/Olympus' }));
    handle('profiles/senior-001', message({ ...PROFILE, thresholds: [{ ...PROFILE.thresholds[0]!, durationInMinutes: 0 }] }));
    handle('profiles/senior-001', Buffer.from('{'));
    expect(received).toHaveLength(1);
  });
});

describe('chargement initial depuis l\'API', () => {
  const source = { apiUrl: 'http://api:3000', serviceToken: 'secret', retryDelayMs: 1 };

  it('réessaie tant que l\'API ne répond pas, envoie la clé de service, garde les profils valides', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json([PROFILE, { ...PROFILE, seniorId: 'senior-002', timeZone: 'Mars/Olympus' }]));
    const profiles = await fetchProfilesUntilAvailable(source, silentLogger, () => false, fetchMock);
    expect(profiles?.map((p) => p.seniorId)).toEqual(['senior-001']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://api:3000/internal/activity-profiles');
    expect(init.headers).toEqual({ 'x-service-token': 'secret' });
  });

  it('s\'arrête quand le service s\'arrête', async () => {
    let stopped = false;
    const fetchMock = vi.fn().mockImplementation(async () => {
      stopped = true;
      throw new TypeError('fetch failed');
    });
    await expect(fetchProfilesUntilAvailable(source, silentLogger, () => stopped, fetchMock)).resolves.toBeNull();
  });
});

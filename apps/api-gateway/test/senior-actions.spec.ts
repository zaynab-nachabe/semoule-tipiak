import { ServiceUnavailableException } from '@nestjs/common';
import { hasCapability } from '../src/access/access';
import { IngestionClient, toAppActionBody } from '../src/actions/ingestion-client';
import { loadConfig } from '../src/config';

describe('actions du senior (ADR 0007)', () => {
  it('« tout va bien » et « aide » : le senior seulement', () => {
    expect(hasCapability('SENIOR', 'CANCEL_ALERT')).toBe(true);
    expect(hasCapability('SENIOR', 'REQUEST_HELP')).toBe(true);
    for (const role of ['FAMILY', 'MEDICAL'] as const) {
      expect(hasCapability(role, 'CANCEL_ALERT')).toBe(false);
      expect(hasCapability(role, 'REQUEST_HELP')).toBe(false);
    }
  });

  it('le corps envoyé à Node-RED vient de la source « application » du senior', () => {
    expect(toAppActionBody('senior-001', { kind: 'CANCEL_ALERT', alertId: 'a-1' })).toEqual({
      sensorId: 'app-senior-001',
      event: 'CANCEL_ALERT',
      alertId: 'a-1',
    });
    expect(toAppActionBody('senior-001', { kind: 'HELP_BUTTON' })).toEqual({ sensorId: 'app-senior-001', event: 'HELP_BUTTON' });
  });
});

describe('IngestionClient', () => {
  const realFetch = global.fetch;
  const client = new IngestionClient(loadConfig({ NODE_RED_URL: 'http://node-red:1880/' }));
  afterEach(() => {
    global.fetch = realFetch;
  });

  const answer = (status: number, body: unknown) =>
    jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

  it('transmet l\'action à POST /ingest/app et renvoie l\'eventId du signal', async () => {
    const fetchMock = answer(202, { accepted: true, eventId: 'e-1' });
    global.fetch = fetchMock;
    await expect(client.send('senior-001', { kind: 'HELP_BUTTON' })).resolves.toEqual({ eventId: 'e-1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://node-red:1880/ingest/app');
    expect(JSON.parse(init.body)).toEqual({ sensorId: 'app-senior-001', event: 'HELP_BUTTON' });
  });

  it('503 si Node-RED refuse le message', async () => {
    global.fetch = answer(422, { accepted: false, reason: 'UNKNOWN_SENSOR', details: 'absent du registre' });
    await expect(client.send('senior-002', { kind: 'HELP_BUTTON' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('503 si Node-RED est injoignable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.send('senior-001', { kind: 'CANCEL_ALERT', alertId: 'a-1' })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

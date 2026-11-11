import { BadRequestException } from '@nestjs/common';
import { hasCapability } from '../src/access/access';
import { parseThresholds, toActivityProfile, toRow } from '../src/profiles/activity-profile';
import { sameSecret } from '../src/profiles/profiles.controller';

const day = { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, timeRange: { startTime: '07:00', endTime: '22:00' } } as const;
const night = { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 600, timeRange: { startTime: '22:00', endTime: '07:00' } } as const;

describe('profil d\'activité (ADR 0010)', () => {
  it('depuis la base : plages par heure de début, le seuil sans plage en dernier', () => {
    const profile = toActivityProfile({ id: 'senior-001', timeZone: 'Europe/Paris' }, [
      { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 90, startTime: null, endTime: null },
      { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 600, startTime: '22:00', endTime: '07:00' },
      { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 120, startTime: '07:00', endTime: '22:00' },
    ]);
    expect(profile).toEqual({
      seniorId: 'senior-001',
      timeZone: 'Europe/Paris',
      thresholds: [day, night, { condition: 'MAX_INACTIVITY_MINUTES', durationInMinutes: 90, timeRange: null }],
      absence: null,
    });
  });

  it("l'absence déclarée est reprise telle quelle dans le profil", () => {
    const absence = { since: '2026-01-15T09:00:00.000Z', until: '2026-01-15T17:00:00.000Z' };
    expect(toActivityProfile({ id: 'senior-001', timeZone: 'Europe/Paris' }, [], absence).absence).toEqual(absence);
  });

  it('aller-retour seuil -> ligne -> seuil', () => {
    const row = toRow('senior-001', night);
    expect(toActivityProfile({ id: 'senior-001', timeZone: 'Europe/Paris' }, [row]).thresholds).toEqual([night]);
  });

  it('valide le corps de PUT …/thresholds', () => {
    expect(parseThresholds({ thresholds: [day, night] })).toEqual([day, night]);
    expect(parseThresholds({ thresholds: [] })).toEqual([]);
    const refused = [
      null,
      {},
      { thresholds: [{ ...day, durationInMinutes: 0 }] },
      { thresholds: [{ ...day, durationInMinutes: 1441 }] },
      { thresholds: [{ ...day, timeRange: { startTime: '7h', endTime: '22:00' } }] },
      { thresholds: [{ ...day, condition: 'MAX_HEART_RATE' }] },
      { thresholds: [{ ...day, timeRange: null }, { ...night, timeRange: null }] }, // deux seuils par défaut
    ];
    for (const body of refused) expect(() => parseThresholds(body)).toThrow(BadRequestException);
  });

  it('seuils : équipe médicale uniquement', () => {
    expect(hasCapability('MEDICAL', 'MANAGE_THRESHOLDS')).toBe(true);
    expect(hasCapability('FAMILY', 'MANAGE_THRESHOLDS')).toBe(false);
    expect(hasCapability('SENIOR', 'MANAGE_THRESHOLDS')).toBe(false);
  });

  it('clé de service : comparaison exacte', () => {
    expect(sameSecret('secret', 'secret')).toBe(true);
    expect(sameSecret('secreT', 'secret')).toBe(false);
    expect(sameSecret('', 'secret')).toBe(false);
  });
});

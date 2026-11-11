import { BadRequestException } from '@nestjs/common';
import { hasCapability } from '../src/access/access';
import { endsOnActivity, isOngoing, parseReturnTime, toAbsenceView } from '../src/absence/absence';
import { deriveSeniorStatus } from '../src/seniors/senior-status';

const NOW = new Date('2026-01-15T09:00:00.000Z');
const at = (iso: string) => new Date(iso);
const absence = (patch: Partial<{ startedAt: Date; expectedReturnAt: Date; endedAt: Date | null }> = {}) => ({
  startedAt: NOW,
  expectedReturnAt: at('2026-01-15T17:00:00.000Z'),
  endedAt: null,
  ...patch,
});
const GRACE = 15 * 60_000;

describe("absence déclarée (« je m'absente », ADR 0011)", () => {
  it('retour prévu : date ISO UTC, dans le futur, au plus 24 h', () => {
    expect(parseReturnTime({ until: '2026-01-15T17:00:00.000Z' }, NOW)).toEqual(at('2026-01-15T17:00:00.000Z'));
    expect(parseReturnTime({ until: '2026-01-16T09:00:00.000Z' }, NOW)).toEqual(at('2026-01-16T09:00:00.000Z')); // 24 h pile
    for (const body of [null, {}, { until: '17:00' }, { until: '2026-01-15T17:00:00+01:00' }, { until: '2026-01-15T08:59:00.000Z' }, { until: '2026-01-16T09:00:01.000Z' }]) {
      expect(() => parseReturnTime(body, NOW)).toThrow(BadRequestException);
    }
  });

  it("en cours tant qu'elle n'est ni terminée ni dépassée", () => {
    expect(isOngoing(absence(), at('2026-01-15T16:59:00.000Z'))).toBe(true);
    expect(isOngoing(absence(), at('2026-01-15T17:00:00.000Z'))).toBe(false);
    expect(isOngoing(absence({ endedAt: at('2026-01-15T10:00:00.000Z') }), at('2026-01-15T11:00:00.000Z'))).toBe(false);
  });

  it('un mouvement au domicile la termine, sauf pendant le délai de départ', () => {
    expect(endsOnActivity(absence(), at('2026-01-15T09:10:00.000Z'), GRACE)).toBe(false); // encore en train de partir
    expect(endsOnActivity(absence(), at('2026-01-15T09:15:00.000Z'), GRACE)).toBe(true); // rentré(e) plus tôt
    expect(endsOnActivity(absence(), at('2026-01-15T18:00:00.000Z'), GRACE)).toBe(false); // déjà terminée à l'heure prévue
  });

  it('vue : depuis le départ, jusqu au retour prévu', () => {
    expect(toAbsenceView(absence())).toEqual({ since: '2026-01-15T09:00:00.000Z', until: '2026-01-15T17:00:00.000Z' });
  });

  it('le senior seulement la déclare ; tous les rôles la voient dans le statut', () => {
    expect(hasCapability('SENIOR', 'DECLARE_ABSENCE')).toBe(true);
    expect(hasCapability('FAMILY', 'DECLARE_ABSENCE')).toBe(false);
    expect(hasCapability('MEDICAL', 'DECLARE_ABSENCE')).toBe(false);
    const view = toAbsenceView(absence());
    for (const role of ['SENIOR', 'FAMILY', 'MEDICAL'] as const) {
      const status = deriveSeniorStatus({ seniorId: 'senior-001', recentAlerts: [], lastPresence: null, lastHeartRate: null, absence: view }, role);
      expect(status.absence).toEqual(view);
      expect(status.overallStatus).toBe('OK');
    }
  });
});

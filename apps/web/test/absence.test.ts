import { describe, expect, it } from 'vitest';
import { defaultReturnTime, returnTimeFor } from '../src/model/absence';

// Heures locales du navigateur : on construit les dates en heure locale pour que le test ne dépende pas du fuseau.
const local = (h: number, m: number, dayOffset = 0) => new Date(2026, 0, 15 + dayOffset, h, m, 0, 0);

describe("« je m'absente » : heure de retour", () => {
  it('aujourd hui si l heure est à venir, demain sinon', () => {
    const now = local(9, 0);
    expect(returnTimeFor('17:00', now)).toEqual(local(17, 0));
    expect(returnTimeFor('08:30', now)).toEqual(local(8, 30, 1));
  });

  it('refuse un format invalide', () => {
    expect(returnTimeFor('17h', local(9, 0))).toBeNull();
    expect(returnTimeFor('', local(9, 0))).toBeNull();
  });

  it('heure proposée : dans 2 h, arrondie au quart d heure suivant', () => {
    expect(defaultReturnTime(local(9, 5))).toBe('11:15');
    expect(defaultReturnTime(local(23, 50))).toBe('02:00');
  });
});

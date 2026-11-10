// Dépôt ActivityProfileRepository (DDD §4.6). Synchrone et en mémoire : les profils sont chargés
// depuis l'API au démarrage puis mis à jour par message (ADR 0010) ; jamais de requête BDD ici.

import type { ActivityProfile } from '../aggregates/activity-profile.js';

export interface ActivityProfileRepository {
  findBySeniorId(seniorId: string): ActivityProfile | undefined;
  save(profile: ActivityProfile): void;
  all(): ActivityProfile[];
}

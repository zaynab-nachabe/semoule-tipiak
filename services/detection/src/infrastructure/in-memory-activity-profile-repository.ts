import type { ActivityProfile } from '../domain/aggregates/activity-profile.js';
import type { ActivityProfileRepository } from '../domain/repositories/activity-profile-repository.js';

/** Profils d'activité en mémoire, un par senior. */
export class InMemoryActivityProfileRepository implements ActivityProfileRepository {
  private readonly profiles = new Map<string, ActivityProfile>();

  findBySeniorId(seniorId: string): ActivityProfile | undefined {
    return this.profiles.get(seniorId);
  }

  save(profile: ActivityProfile): void {
    this.profiles.set(profile.seniorId, profile);
  }

  all(): ActivityProfile[] {
    return [...this.profiles.values()];
  }
}

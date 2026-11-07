// Événement interne FallSuspected (DDD §4.4) : « Déclenche la demande de pré-confirmation. »
// Il reste interne au service : seul PreConfirmationRequested est publié (docs/format-evenements.md §6).

import type { RawSignal } from '@project/shared-types';

export type FallImpactSignal = Extract<RawSignal, { type: 'FALL_IMPACT' }>;

export interface FallSuspected {
  readonly seniorId: string;
  readonly impact: FallImpactSignal;
}

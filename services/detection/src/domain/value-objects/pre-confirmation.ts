// Value object PreConfirmation (DDD §4.3) : { seniorId, alertId, requestedAt, expiresAt }.

export interface PreConfirmation {
  readonly seniorId: string;
  readonly alertId: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
}

export function createPreConfirmation(seniorId: string, alertId: string, requestedAt: Date, delayMs: number): PreConfirmation {
  return Object.freeze({
    seniorId,
    alertId,
    requestedAt,
    expiresAt: new Date(requestedAt.getTime() + delayMs),
  });
}

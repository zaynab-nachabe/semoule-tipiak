export { ActivityProfile, localMinutes } from './domain/aggregates/activity-profile.js';
export { Alert, AlertStatus, type EscalatedSeverity } from './domain/entities/alert.js';
export type { FallSuspected } from './domain/events/fall-suspected.js';
export type { ActivityProfileRepository } from './domain/repositories/activity-profile-repository.js';
export type { AlertRepository } from './domain/repositories/alert-repository.js';
export { BED_LOCATION, CorrelationService, type CorrelationServiceDependencies } from './domain/services/correlation-service.js';
export type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from './domain/services/ports.js';
export {
  DEFAULT_FALL_DETECTION_POLICY,
  assertValidPolicy,
  type FallDetectionPolicy,
} from './domain/value-objects/fall-detection-policy.js';
export {
  DEFAULT_INACTIVITY_POLICY,
  assertValidInactivityPolicy,
  hasReassuringHeartRate,
  type InactivityPolicy,
} from './domain/value-objects/inactivity-policy.js';
export type { PreConfirmation } from './domain/value-objects/pre-confirmation.js';
export { FALLEN, advanceRecovery, type RecoveryProgress } from './domain/value-objects/recovery-progress.js';
export { InMemoryActivityProfileRepository } from './infrastructure/in-memory-activity-profile-repository.js';
export { InMemoryAlertRepository } from './infrastructure/in-memory-alert-repository.js';
export { systemClock, timeoutScheduler, uuidGenerator } from './infrastructure/system.js';

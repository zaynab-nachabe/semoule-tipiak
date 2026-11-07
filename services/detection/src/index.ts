export { Alert, AlertStatus } from './domain/entities/alert.js';
export type { FallSuspected } from './domain/events/fall-suspected.js';
export type { AlertRepository } from './domain/repositories/alert-repository.js';
export { CorrelationService, type CorrelationServiceDependencies } from './domain/services/correlation-service.js';
export type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from './domain/services/ports.js';
export {
  DDD_PRE_CONFIRMATION_DELAY_MS,
  assertValidPolicy,
  type FallDetectionPolicy,
} from './domain/value-objects/fall-detection-policy.js';
export type { PreConfirmation } from './domain/value-objects/pre-confirmation.js';
export { InMemoryAlertRepository } from './infrastructure/in-memory-alert-repository.js';
export { systemClock, timeoutScheduler, uuidGenerator } from './infrastructure/system.js';

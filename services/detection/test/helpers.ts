// Outils de test : temps contrôlé, identifiants déterministes, publication capturée, fabrique de signaux.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import type { DomainEvent, RawSignal, SignalPayloadByType, SignalType } from '@project/shared-types';
import type { Clock, DomainEventPublisher, IdGenerator, ScheduledTask, Scheduler } from '../src/domain/services/ports.js';

export const T0 = new Date('2026-01-15T14:32:08.000Z');

/** Horloge et minuteur manuels : le temps n'avance que via advance(). */
export class FakeTime implements Clock, Scheduler {
  private current: Date;
  private tasks: { at: number; task: () => void; cancelled: boolean }[] = [];

  constructor(start: Date = T0) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  schedule(at: Date, task: () => void): ScheduledTask {
    const entry = { at: at.getTime(), task, cancelled: false };
    this.tasks.push(entry);
    return { cancel: () => (entry.cancelled = true) };
  }

  advance(ms: number): void {
    const target = this.current.getTime() + ms;
    for (;;) {
      const due = this.tasks
        .filter((t) => !t.cancelled && t.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.cancelled = true;
      this.current = new Date(due.at);
      due.task();
    }
    this.current = new Date(target);
  }

  get pendingTasks(): number {
    return this.tasks.filter((t) => !t.cancelled).length;
  }
}

/** UUID déterministes : 00000000-0000-4000-8000-000000000001, …002, … */
export class SequentialIds implements IdGenerator {
  private n = 0;
  next(): string {
    this.n += 1;
    return `00000000-0000-4000-8000-${String(this.n).padStart(12, '0')}`;
  }
}

export class CapturingPublisher implements DomainEventPublisher {
  readonly events: DomainEvent[] = [];
  publish(event: DomainEvent): void {
    this.events.push(event);
  }
  get types(): string[] {
    return this.events.map((e) => e.type);
  }
  last<T extends DomainEvent['type']>(type: T): Extract<DomainEvent, { type: T }> {
    const found = [...this.events].reverse().find((e) => e.type === type);
    if (!found) throw new Error(`aucun événement ${type} publié (publiés : ${this.types.join(', ') || 'aucun'})`);
    return found as Extract<DomainEvent, { type: T }>;
  }
}

let signalCounter = 0;
/** Signal normalisé valide ; eventId en UUID pour respecter le contrat. */
export function signal<T extends SignalType>(
  type: T,
  payload: SignalPayloadByType[T],
  options: { seniorId?: string; sensorId?: string; at?: Date } = {},
): Extract<RawSignal, { type: T }> {
  signalCounter += 1;
  return {
    eventId: `a1b2c3d4-0000-4000-8000-${String(signalCounter).padStart(12, '0')}`,
    seniorId: options.seniorId ?? 'senior-001',
    sensorId: options.sensorId ?? (type === 'PIR_MOTION' ? 'pir-salon' : 'watch-001'),
    type,
    timestamp: (options.at ?? T0).toISOString(),
    payload,
  } as Extract<RawSignal, { type: T }>;
}

/** Validateur JSON Schema des événements de domaine publiés (packages/shared-types). */
const schemaPath = join(__dirname, '..', '..', '..', 'packages', 'shared-types', 'schemas', 'domain-event.schema.json');
const validateDomainEvent = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync(schemaPath, 'utf8')));

export function assertConformsToContract(event: DomainEvent): void {
  const type = event.type;
  if (!validateDomainEvent(event)) {
    throw new Error(`${type} non conforme au contrat : ${JSON.stringify(validateDomainEvent.errors)}`);
  }
}

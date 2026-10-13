// Implémentations « réelles » des ports du domaine : horloge système, minuteur, UUID.

import { randomUUID } from 'node:crypto';
import type { Clock, IdGenerator, ScheduledTask, Scheduler } from '../domain/services/ports.js';

export const systemClock: Clock = {
  now: () => new Date(),
};

export const timeoutScheduler: Scheduler = {
  schedule(at: Date, task: () => void): ScheduledTask {
    const handle = setTimeout(task, Math.max(0, at.getTime() - Date.now()));
    return { cancel: () => clearTimeout(handle) };
  },
};

export const uuidGenerator: IdGenerator = {
  next: () => randomUUID(),
};

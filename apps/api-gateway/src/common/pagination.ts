import { BadRequestException } from '@nestjs/common';

export interface PageRequest {
  page: number;
  pageSize: number;
}

/** ?page=…&pageSize=… (contrat §6) ; pageSize plafonné à 100. */
export function parsePage(page?: string, pageSize?: string): PageRequest {
  const p = page === undefined ? 1 : Number(page);
  const s = pageSize === undefined ? 20 : Number(pageSize);
  if (!Number.isInteger(p) || p < 1) throw new BadRequestException('page doit être un entier ≥ 1');
  if (!Number.isInteger(s) || s < 1 || s > 100) throw new BadRequestException('pageSize doit être un entier entre 1 et 100');
  return { page: p, pageSize: s };
}

export function parseDate(name: string, value?: string): Date | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${name} doit être une date ISO 8601`);
  return date;
}

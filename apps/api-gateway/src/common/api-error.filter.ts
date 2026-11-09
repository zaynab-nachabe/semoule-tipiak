// Format d'erreur du contrat (§6) : { "error": { "code": "...", "message": "..." } }.

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiError } from '@project/shared-types';
import type { Response } from 'express';

const CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
};

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    const message = exception instanceof HttpException ? messageOf(exception) : 'Erreur interne';
    const body: ApiError = { error: { code: CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'), message } };
    response.status(status).json(body);
  }
}

function messageOf(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  return Array.isArray(message) ? message.join(', ') : typeof message === 'string' ? message : exception.message;
}

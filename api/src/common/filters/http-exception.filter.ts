import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, any>;
        message = responseObj.message || message;
        // Keep any structured fields a handler attached (e.g. `code`, `requiresConfirmation`,
        // `projections`) so the client can act on them; they are surfaced under `errors`.
        const { message: _m, errors: nested, statusCode: _s, error: _e, ...extras } = responseObj;
        errors = nested || Object.keys(extras).length ? { ...extras, ...(nested && typeof nested === 'object' ? nested : {}) } : null;
        if (Array.isArray(nested)) errors = nested;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled exception: ${exception.message}`,
        exception.stack,
      );
    }

    // Report unexpected failures only — a validation error or a 404 is expected client-facing
    // behavior, not a bug. Nest catches exceptions inside the request pipeline before they'd ever
    // reach Sentry's own automatic process-level handlers, so this filter has to report them itself.
    if (status >= 500) {
      Sentry.captureException(exception);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}

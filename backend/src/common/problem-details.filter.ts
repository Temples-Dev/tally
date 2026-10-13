import {
	type ArgumentsHost,
	type BadRequestException,
	Catch,
	type ExceptionFilter,
	HttpException,
	HttpStatus,
} from "@nestjs/common";
import type { Request, Response } from "express";

interface FieldError {
	field: string;
	code: string;
	message: string;
}

function errorCodeFor(status: number): string {
	switch (status) {
		case HttpStatus.BAD_REQUEST:
			return "VALIDATION_ERROR";
		case HttpStatus.UNAUTHORIZED:
			return "UNAUTHENTICATED";
		case HttpStatus.FORBIDDEN:
			return "FORBIDDEN";
		case HttpStatus.NOT_FOUND:
			return "NOT_FOUND";
		case HttpStatus.CONFLICT:
			return "CONFLICT";
		case HttpStatus.PRECONDITION_FAILED:
			return "PRECONDITION_FAILED";
		case HttpStatus.UNPROCESSABLE_ENTITY:
			return "UNPROCESSABLE_CONTENT";
		case HttpStatus.TOO_MANY_REQUESTS:
			return "RATE_LIMITED";
		default:
			return "INTERNAL_ERROR";
	}
}

function titleFor(status: number): string {
	switch (status) {
		case HttpStatus.BAD_REQUEST:
			return "Validation failed";
		case HttpStatus.UNAUTHORIZED:
			return "Authentication required";
		case HttpStatus.FORBIDDEN:
			return "Access denied";
		case HttpStatus.NOT_FOUND:
			return "Resource not found";
		case HttpStatus.CONFLICT:
			return "State conflict";
		case HttpStatus.UNPROCESSABLE_ENTITY:
			return "Unprocessable content";
		case HttpStatus.TOO_MANY_REQUESTS:
			return "Rate limit exceeded";
		default:
			return "Unexpected failure";
	}
}

function fieldErrors(exception: object): FieldError[] {
	const response = (exception as BadRequestException).getResponse();
	if (
		typeof response === "object" &&
		response !== null &&
		!Array.isArray(response)
	) {
		const message = (response as { message?: unknown }).message;
		const messages = Array.isArray(message) ? message : [message];
		return messages
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => ({
				field: "body",
				code: "INVALID_FIELD",
				message: entry,
			}));
	}
	return [];
}

/**
 * Shapes every failure as RFC 7807-style problem details with a stable code
 * and the request correlation id. Internal messages never leave the process.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
	catch(exception: unknown, host: ArgumentsHost): void {
		const context = host.switchToHttp();
		const request = context.getRequest<Request & { correlationId?: string }>();
		const response = context.getResponse<Response>();
		const requestId =
			typeof request.correlationId === "string"
				? request.correlationId
				: "req_unknown";

		if (exception instanceof HttpException) {
			const status = exception.getStatus();
			if (status >= 500) {
				this.send(
					response,
					requestId,
					500,
					"INTERNAL_ERROR",
					"Unexpected failure.",
				);
				return;
			}
			const code = errorCodeFor(status);
			const detail =
				exception.message.length > 0
					? exception.message
					: titleFor(status).toLowerCase();
			this.send(
				response,
				requestId,
				status,
				code,
				detail,
				fieldErrors(exception),
			);
			return;
		}
		this.send(
			response,
			requestId,
			500,
			"INTERNAL_ERROR",
			"Unexpected failure.",
		);
	}

	private send(
		response: Response,
		requestId: string,
		status: number,
		code: string,
		detail: string,
		errors: FieldError[] = [],
	): void {
		response.status(status).json({
			type: `https://api.tally.dev/errors/${code.toLowerCase().replace(/_/g, "-")}`,
			title: titleFor(status),
			status,
			code,
			detail,
			requestId,
			...(errors.length > 0 ? { errors } : {}),
		});
	}
}

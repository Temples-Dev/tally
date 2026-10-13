import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

export const CORRELATION_ID_HEADER = "x-correlation-id";

function newCorrelationId(): string {
	return `req_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Echoes the caller-supplied correlation id, or mints one. Never trusts it for auth. */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
	use(request: Request, response: Response, next: NextFunction): void {
		const header = request.headers[CORRELATION_ID_HEADER];
		const correlationId =
			typeof header === "string" && header.length > 0
				? header.slice(0, 128)
				: newCorrelationId();
		(request as Request & { correlationId?: string }).correlationId =
			correlationId;
		response.setHeader(CORRELATION_ID_HEADER, correlationId);
		next();
	}
}

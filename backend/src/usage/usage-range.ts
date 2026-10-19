import { UnprocessableEntityException } from "@nestjs/common";

const DAY_MS = 86_400_000;

export interface UtcDayRange {
	from: Date;
	to: Date;
}

/**
 * Parses a required, UTC-day-aligned, half-open reporting range.
 */
export function parseUtcDayRange(
	fromRaw: string,
	toRaw: string,
	maxDays = 366,
): UtcDayRange {
	const from = new Date(fromRaw);
	const to = new Date(toRaw);
	if (from.getTime() >= to.getTime()) {
		throw new UnprocessableEntityException("from must be earlier than to.");
	}
	if (from.getTime() % DAY_MS !== 0 || to.getTime() % DAY_MS !== 0) {
		throw new UnprocessableEntityException(
			"from and to must be UTC day boundaries.",
		);
	}
	if (to.getTime() - from.getTime() > maxDays * DAY_MS) {
		throw new UnprocessableEntityException(
			`The range must not exceed ${maxDays} days.`,
		);
	}
	return { from, to };
}

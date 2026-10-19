import { createHash } from "node:crypto";

/** Matches the NUMERIC(24,8) storage contract: at most 16 integer digits. */
export const QUANTITY_PATTERN = /^-?\d{1,16}(?:\.\d{1,8})?$/;

const DIMENSION_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_DIMENSIONS = 20;
const MAX_DIMENSION_VALUE_LENGTH = 256;

/**
 * Normalizes a validated decimal string without converting it to a JavaScript
 * number. Returns null when the input does not fit the storage contract.
 */
export function normalizeQuantity(raw: string): string | null {
	const match = /^(-?)(\d{1,16})(?:\.(\d{1,8}))?$/.exec(raw.trim());
	if (match === null) {
		return null;
	}
	const integer = match[2].replace(/^0+(?=\d)/, "");
	const fraction = (match[3] ?? "").replace(/0+$/, "");
	const isZero = integer === "0" && fraction === "";
	const negative = match[1] === "-" && !isZero;
	return `${negative ? "-" : ""}${integer}${fraction === "" ? "" : `.${fraction}`}`;
}

export function isNegativeQuantity(normalized: string): boolean {
	return normalized.startsWith("-");
}

/**
 * Produces deterministic JSON so equivalent dimension maps hash identically.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([left], [right]) => left.localeCompare(right));
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function hashUsagePayload(input: {
	customerAccountId: string;
	subscriptionId: string | null;
	metricId: string;
	quantity: string;
	occurredAt: Date;
	dimensions: Record<string, unknown>;
}): string {
	const canonical = canonicalJson({
		customerAccountId: input.customerAccountId,
		subscriptionId: input.subscriptionId,
		metricId: input.metricId,
		quantity: input.quantity,
		occurredAt: input.occurredAt.toISOString(),
		dimensions: input.dimensions,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/** Validates dimension shape, cardinality, and the metric allowlist. */
export function validateDimensions(
	dimensions: unknown,
	allowlist: string[] | null,
): string | null {
	if (dimensions === undefined) {
		return null;
	}
	if (
		typeof dimensions !== "object" ||
		dimensions === null ||
		Array.isArray(dimensions)
	) {
		return "Dimensions must be an object.";
	}
	const entries = Object.entries(dimensions as Record<string, unknown>);
	if (entries.length > MAX_DIMENSIONS) {
		return `At most ${MAX_DIMENSIONS} dimensions are allowed.`;
	}
	if (allowlist !== null && allowlist.length > 0) {
		const unexpected = entries.find(([key]) => !allowlist.includes(key));
		if (unexpected !== undefined) {
			return `Dimension ${unexpected[0]} is not allowed for this metric.`;
		}
	}
	for (const [key, value] of entries) {
		if (!DIMENSION_KEY_PATTERN.test(key)) {
			return `Dimension key ${key} is invalid.`;
		}
		if (typeof value === "string") {
			if (value.length > MAX_DIMENSION_VALUE_LENGTH) {
				return `Dimension ${key} exceeds the maximum value length.`;
			}
			continue;
		}
		if (typeof value === "number" && Number.isFinite(value)) {
			continue;
		}
		if (typeof value === "boolean") {
			continue;
		}
		return `Dimension ${key} must be a string, number, or boolean.`;
	}
	return null;
}

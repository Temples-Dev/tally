import { normalizeQuantity } from "../usage/usage-payload";

const SCALE = 100_000_000n;

/**
 * Parses a non-negative NUMERIC(24,8) value into fixed-point units of 1e-8.
 * Returns null when the value is malformed or negative.
 */
export function parseQuotaAmount(raw: string): bigint | null {
	const normalized = normalizeQuantity(raw);
	if (normalized === null || normalized.startsWith("-")) {
		return null;
	}
	const [integer, fraction = ""] = normalized.split(".");
	return BigInt(integer) * SCALE + BigInt(fraction.padEnd(8, "0"));
}

/** Formats fixed-point units without exposing binary floating point. */
export function formatQuotaAmount(value: bigint): string {
	const negative = value < 0n;
	const absolute = negative ? -value : value;
	const integer = absolute / SCALE;
	const fraction = (absolute % SCALE).toString().padStart(8, "0");
	const trimmed = fraction.replace(/0+$/, "");
	const body = trimmed === "" ? integer.toString() : `${integer}.${trimmed}`;
	return negative ? `-${body}` : body;
}

export function addQuotaAmounts(left: string, right: string): string {
	return formatQuotaAmount(
		(parseQuotaAmount(left) ?? 0n) + (parseQuotaAmount(right) ?? 0n),
	);
}

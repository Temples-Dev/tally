const SCALE = 100_000_000n;

/** Currency minor-unit precision. Unsupported currencies are rejected. */
const CURRENCY_PRECISION = new Map<string, number>([
	["USD", 2],
	["EUR", 2],
	["GBP", 2],
	["GHS", 2],
	["NGN", 2],
	["KES", 2],
	["ZAR", 2],
	["CAD", 2],
	["AUD", 2],
	["JPY", 0],
	["XOF", 0],
]);

export function currencyPrecision(currency: string): number | null {
	return CURRENCY_PRECISION.get(currency.toUpperCase()) ?? null;
}

/** Parses a non-negative decimal with at most eight fractional places. */
export function parseDecimal(raw: string): bigint | null {
	const match = /^(\d{1,16})(?:\.(\d{1,8}))?$/.exec(raw.trim());
	if (match === null) {
		return null;
	}
	return BigInt(match[1]) * SCALE + BigInt((match[2] ?? "").padEnd(8, "0"));
}

export function formatDecimal(value: bigint): string {
	const negative = value < 0n;
	const absolute = negative ? -value : value;
	const integer = absolute / SCALE;
	const fraction = (absolute % SCALE)
		.toString()
		.padStart(8, "0")
		.replace(/0+$/, "");
	const body = fraction === "" ? integer.toString() : `${integer}.${fraction}`;
	return negative ? `-${body}` : body;
}

/** Rounds a 1e-8 amount to the currency's minor unit using half-up. */
export function roundToCurrency(value: bigint, precision: number): bigint {
	const factor = 10n ** BigInt(8 - precision);
	if (factor === 1n) {
		return value;
	}
	return ((value + factor / 2n) / factor) * factor;
}

/** Multiplies quantity by unit price and rounds the result once. */
export function multiplyAmount(
	quantity: bigint,
	unitPrice: bigint,
	precision: number,
): bigint {
	const product = quantity * unitPrice;
	const factor = 10n ** BigInt(16 - precision);
	const minorUnits = (product + factor / 2n) / factor;
	return minorUnits * 10n ** BigInt(8 - precision);
}

export function sumAmounts(values: bigint[]): bigint {
	return values.reduce((total, value) => total + value, 0n);
}

export function maxAmount(left: bigint, right: bigint): bigint {
	return left > right ? left : right;
}

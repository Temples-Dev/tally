import { EntitlementValueType } from "./enums";

/** Validates an entitlement value against its declared type. JSON accepts anything. */
export function validateEntitlementValue(
	valueType: EntitlementValueType,
	value: unknown,
	validationSchema?: Record<string, unknown> | null,
): string | null {
	switch (valueType) {
		case EntitlementValueType.BOOLEAN:
			return typeof value === "boolean" ? null : "Expected a boolean.";
		case EntitlementValueType.INTEGER:
			return typeof value === "number" && Number.isInteger(value)
				? null
				: "Expected an integer.";
		case EntitlementValueType.DECIMAL:
			return typeof value === "number" && Number.isFinite(value)
				? null
				: "Expected a number.";
		case EntitlementValueType.STRING:
			return typeof value === "string" ? null : "Expected a string.";
		case EntitlementValueType.ENUM: {
			const allowed = (validationSchema?.enum ?? validationSchema?.values) as
				| unknown[]
				| undefined;
			if (!Array.isArray(allowed)) {
				return "Enum definition requires an enum member list in its validation schema.";
			}
			return allowed.includes(value)
				? null
				: "Value is not an allowed enum member.";
		}
		case EntitlementValueType.JSON:
			return null;
	}
}

import { EntitlementValueType } from "./enums";
import { validateEntitlementValue } from "./value-validation";

describe("validateEntitlementValue", () => {
	it("checks each value type", () => {
		expect(
			validateEntitlementValue(EntitlementValueType.BOOLEAN, true, null),
		).toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.BOOLEAN, "yes", null),
		).not.toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.INTEGER, 25, null),
		).toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.INTEGER, 2.5, null),
		).not.toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.DECIMAL, 2.5, null),
		).toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.STRING, "x", null),
		).toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.JSON, { deep: [1] }, null),
		).toBeNull();
	});

	it("restricts enums to the schema members", () => {
		const schema = { enum: ["basic", "priority"] };
		expect(
			validateEntitlementValue(EntitlementValueType.ENUM, "basic", schema),
		).toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.ENUM, "vip", schema),
		).not.toBeNull();
		expect(
			validateEntitlementValue(EntitlementValueType.ENUM, "basic", null),
		).not.toBeNull();
	});
});

import { ChangeType, SubscriptionStatus } from "./enums";
import {
	canTransition,
	changeTypeFor,
	isEntitlementEligible,
} from "./lifecycle";

describe("subscription lifecycle", () => {
	it("allows the documented transitions", () => {
		expect(
			canTransition(SubscriptionStatus.PENDING, SubscriptionStatus.ACTIVE),
		).toBe(true);
		expect(
			canTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED),
		).toBe(true);
		expect(
			canTransition(SubscriptionStatus.PAST_DUE, SubscriptionStatus.ACTIVE),
		).toBe(true);
		expect(
			canTransition(SubscriptionStatus.PAUSED, SubscriptionStatus.ACTIVE),
		).toBe(true);
		expect(
			canTransition(SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE),
		).toBe(true);
	});

	it("rejects exits from terminal states and backward moves", () => {
		expect(
			canTransition(SubscriptionStatus.CANCELLED, SubscriptionStatus.ACTIVE),
		).toBe(false);
		expect(
			canTransition(SubscriptionStatus.EXPIRED, SubscriptionStatus.ACTIVE),
		).toBe(false);
		expect(
			canTransition(SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING),
		).toBe(false);
		expect(
			canTransition(SubscriptionStatus.PENDING, SubscriptionStatus.PAUSED),
		).toBe(false);
	});

	it("records meaningful change types", () => {
		expect(
			changeTypeFor(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED),
		).toBe(ChangeType.PAUSED);
		expect(
			changeTypeFor(SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE),
		).toBe(ChangeType.TRIAL_CONVERTED);
		expect(
			changeTypeFor(SubscriptionStatus.PAST_DUE, SubscriptionStatus.ACTIVE),
		).toBe(ChangeType.RECOVERED);
		expect(() =>
			changeTypeFor(SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING),
		).toThrow();
	});

	it("gates entitlement eligibility by state", () => {
		expect(isEntitlementEligible(SubscriptionStatus.ACTIVE)).toBe(true);
		expect(isEntitlementEligible(SubscriptionStatus.TRIALING)).toBe(true);
		expect(isEntitlementEligible(SubscriptionStatus.PAST_DUE)).toBe(true);
		expect(isEntitlementEligible(SubscriptionStatus.PAUSED)).toBe(false);
		expect(isEntitlementEligible(SubscriptionStatus.CANCELLED)).toBe(false);
		expect(isEntitlementEligible(SubscriptionStatus.PENDING)).toBe(false);
	});
});

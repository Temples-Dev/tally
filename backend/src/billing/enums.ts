export enum PriceStatus {
	ACTIVE = "active",
	ARCHIVED = "archived",
}

export enum BillingInterval {
	MONTH = "month",
	YEAR = "year",
}

export enum PricingModel {
	FLAT = "flat",
	PER_UNIT = "per_unit",
	METERED = "metered",
}

export enum BillingPeriodStatus {
	OPEN = "open",
	INVOICED = "invoiced",
	CLOSED = "closed",
}

export enum BillingCalculationStatus {
	COMPLETED = "completed",
	SUPERSEDED = "superseded",
}

export enum InvoiceStatus {
	DRAFT = "draft",
	OPEN = "open",
	PAID = "paid",
	PARTIALLY_PAID = "partially_paid",
	VOID = "void",
	UNCOLLECTIBLE = "uncollectible",
}

export enum InvoiceLineType {
	FLAT = "flat",
	PER_UNIT = "per_unit",
	METERED = "metered",
	ADJUSTMENT = "adjustment",
	CREDIT = "credit",
}

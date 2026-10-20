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
	CREDITED = "credited",
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

export enum CreditNoteStatus {
	ISSUED = "issued",
	VOID = "void",
}

export enum AdjustmentType {
	CREDIT = "credit",
	DEBIT = "debit",
}

export enum AdjustmentStatus {
	PENDING = "pending",
	APPLIED = "applied",
	VOID = "void",
}

export enum BillingOperationStatus {
	PENDING = "pending",
	RUNNING = "running",
	COMPLETED = "completed",
	FAILED = "failed",
}

export enum ReconciliationRunStatus {
	RUNNING = "running",
	COMPLETED = "completed",
	FAILED = "failed",
}

export enum DiscrepancyStatus {
	OPEN = "open",
	RESOLVED = "resolved",
	IGNORED = "ignored",
}

export enum DiscrepancyCategory {
	INVOICE_TOTAL_MISMATCH = "INVOICE_TOTAL_MISMATCH",
	LINE_TOTAL_MISMATCH = "LINE_TOTAL_MISMATCH",
	CURRENCY_MISMATCH = "CURRENCY_MISMATCH",
	AMOUNT_DUE_MISMATCH = "AMOUNT_DUE_MISMATCH",
	DUPLICATE_INVOICE = "DUPLICATE_INVOICE",
	MISSING_INVOICE = "MISSING_INVOICE",
	BILLING_CALCULATION_MISMATCH = "BILLING_CALCULATION_MISMATCH",
	CREDIT_TOTAL_MISMATCH = "CREDIT_TOTAL_MISMATCH",
	USAGE_MISMATCH = "USAGE_MISMATCH",
}

export enum PaymentProviderCode {
	PAYSTACK = "paystack",
}

export enum PaymentProviderAccountStatus {
	ACTIVE = "active",
	DISABLED = "disabled",
}

export enum PaymentAttemptStatus {
	PENDING = "pending",
	PROCESSING = "processing",
	REQUIRES_ACTION = "requires_action",
	SUCCEEDED = "succeeded",
	FAILED = "failed",
	CANCELLED = "cancelled",
}

export enum PaymentTransactionType {
	PAYMENT = "payment",
	REFUND = "refund",
	REVERSAL = "reversal",
}

export enum PaymentTransactionStatus {
	SUCCEEDED = "succeeded",
	FAILED = "failed",
}

export enum PaymentWebhookVerificationStatus {
	VERIFIED = "verified",
}

export enum PaymentWebhookProcessingStatus {
	PENDING = "pending",
	PROCESSED = "processed",
	FAILED = "failed",
	IGNORED = "ignored",
}

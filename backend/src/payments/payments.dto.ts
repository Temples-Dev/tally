import {
	IsIn,
	IsOptional,
	IsString,
	IsUrl,
	Matches,
	MaxLength,
	MinLength,
} from "class-validator";

const PAYSTACK_SECRET_KEY = /^sk_(?:test|live)_[A-Za-z0-9]+$/;
const PAYSTACK_PUBLIC_KEY = /^pk_(?:test|live)_[A-Za-z0-9]+$/;

export class ConfigurePaymentProviderDto {
	@IsOptional()
	@IsIn(["paystack"])
	provider?: "paystack";

	@IsString()
	@MinLength(16)
	@MaxLength(256)
	@Matches(PAYSTACK_SECRET_KEY, {
		message: "secretKey must be a Paystack secret key.",
	})
	secretKey: string;

	@IsOptional()
	@IsString()
	@MaxLength(256)
	@Matches(PAYSTACK_PUBLIC_KEY, {
		message: "publicKey must be a Paystack public key.",
	})
	publicKey?: string;

	@IsOptional()
	@IsUrl({ require_tld: false, protocols: ["http", "https"] })
	@MaxLength(2048)
	defaultCallbackUrl?: string;
}

export class InitiatePaymentDto {
	@IsOptional()
	@IsIn(["paystack"])
	provider?: "paystack";

	@IsOptional()
	@IsUrl({ require_tld: false, protocols: ["http", "https"] })
	@MaxLength(2048)
	returnUrl?: string;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(200)
	idempotencyKey?: string;
}

import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { IdentityModule } from "../identity/identity.module";
import { JobsModule } from "../jobs/jobs.module";
import { CredentialCipher } from "./credential-cipher.service";
import { PaymentAttempt } from "./entities/payment-attempt.entity";
import { PaymentProviderAccount } from "./entities/payment-provider-account.entity";
import { PaymentTransaction } from "./entities/payment-transaction.entity";
import { PaymentWebhookEvent } from "./entities/payment-webhook-event.entity";
import { PaymentProviderAccountsService } from "./payment-provider-accounts.service";
import { PaymentsWebhookHandler } from "./payments-webhook.handler";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PaystackAdapter } from "./paystack.adapter";

@Module({
	imports: [
		TypeOrmModule.forFeature([
			PaymentProviderAccount,
			PaymentAttempt,
			PaymentTransaction,
			PaymentWebhookEvent,
		]),
		IdentityModule,
		JobsModule,
	],
	controllers: [PaymentsController],
	providers: [
		CredentialCipher,
		PaystackAdapter,
		PaymentProviderAccountsService,
		PaymentsService,
		PaymentsWebhookHandler,
	],
	exports: [PaymentsService, PaymentProviderAccountsService],
})
export class PaymentsModule {}

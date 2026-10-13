import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditService } from "./audit.service";
import { AuditRecord } from "./entities/audit-record.entity";
import { TenantMember } from "./entities/tenant-member.entity";
import { Tenant } from "./entities/tenant.entity";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { TenantMembersService } from "./tenant-members.service";
import { TenantGuard } from "./tenant.guard";
import { TenantsController } from "./tenants.controller";
import { TenantsService } from "./tenants.service";

@Module({
	imports: [TypeOrmModule.forFeature([Tenant, TenantMember, AuditRecord])],
	controllers: [TenantsController],
	providers: [
		AuditService,
		JwtAuthGuard,
		TenantGuard,
		TenantMembersService,
		TenantsService,
	],
	exports: [AuditService, JwtAuthGuard, TenantGuard, TenantMembersService],
})
export class IdentityModule {}

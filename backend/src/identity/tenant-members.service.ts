import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import type { Repository } from "typeorm";

import { TenantMember } from "./entities/tenant-member.entity";
import { Tenant } from "./entities/tenant.entity";
import { MemberStatus } from "./enums";

export interface MembershipCheck {
	member: TenantMember;
	tenant: Tenant;
}

@Injectable()
export class TenantMembersService {
	constructor(
		@InjectRepository(TenantMember)
		private readonly members: Repository<TenantMember>,
		@InjectRepository(Tenant)
		private readonly tenants: Repository<Tenant>,
	) {}

	/**
	 * Tenant-scoped lookup first: the tenant id is a selector, membership is the proof.
	 * Returns null when the tenant does not exist or the identity is not an
	 * active member, so unknown tenants are indistinguishable from forbidden ones.
	 * Tenant lifecycle (suspended/closed) is enforced by the guard, not hidden here.
	 */
	async findActiveMembership(
		externalIdentityId: string,
		tenantId: string,
	): Promise<MembershipCheck | null> {
		const member = await this.members.findOne({
			where: {
				tenantId,
				externalIdentityId,
				status: MemberStatus.ACTIVE,
			},
			relations: { tenant: true },
		});
		if (member === null) {
			return null;
		}
		return { member, tenant: member.tenant };
	}
}

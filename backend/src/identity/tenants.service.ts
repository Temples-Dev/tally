import { ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
// biome-ignore lint/style/useImportType: DataSource must be a value import for decorator metadata.
import { DataSource } from "typeorm";
import type { Repository } from "typeorm";

// biome-ignore lint/style/useImportType: injected tokens must be value imports for decorator metadata.
import { AuditService } from "./audit.service";
import { TenantMember } from "./entities/tenant-member.entity";
import { Tenant } from "./entities/tenant.entity";
import { ActorType, MemberRole, MemberStatus } from "./enums";

@Injectable()
export class TenantsService {
	constructor(
		private readonly dataSource: DataSource,
		@InjectRepository(Tenant)
		private readonly tenants: Repository<Tenant>,
		private readonly audit: AuditService,
	) {}

	/**
	 * Creates a tenant with the caller as its owner, atomically with the audit record.
	 * Slug defaults to a URL-safe form of the name; duplicates conflict.
	 */
	async createTenant(input: {
		name: string;
		slug?: string;
		externalIdentityId: string;
		correlationId?: string;
	}): Promise<Tenant> {
		const trimmedSlug = input.slug?.trim() ?? "";
		const slug = trimmedSlug.length > 0 ? trimmedSlug : slugify(input.name);
		try {
			return await this.dataSource.transaction(async (manager) => {
				const tenant = await manager
					.getRepository(Tenant)
					.save(
						manager.getRepository(Tenant).create({ name: input.name, slug }),
					);
				await manager.getRepository(TenantMember).save(
					manager.getRepository(TenantMember).create({
						tenantId: tenant.id,
						externalIdentityId: input.externalIdentityId,
						role: MemberRole.OWNER,
						status: MemberStatus.ACTIVE,
					}),
				);
				await this.audit.record(
					{
						tenantId: tenant.id,
						actorType: ActorType.HUMAN,
						actorId: input.externalIdentityId,
						action: "tenant.created",
						resourceType: "tenant",
						resourceId: tenant.id,
						correlationId: input.correlationId,
					},
					manager,
				);
				return tenant;
			});
		} catch (error) {
			if (isUniqueViolation(error)) {
				throw new ConflictException("A tenant with this slug already exists.");
			}
			throw error;
		}
	}

	async getTenant(id: string): Promise<Tenant | null> {
		return this.tenants.findOneBy({ id });
	}
}

function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "tenant";
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "23505"
	);
}

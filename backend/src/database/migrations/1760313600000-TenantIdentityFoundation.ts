import type { MigrationInterface, QueryRunner } from "typeorm";

export class TenantIdentityFoundation1760313600000
	implements MigrationInterface
{
	name = "TenantIdentityFoundation1760313600000";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			CREATE TABLE tenants (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				name TEXT NOT NULL,
				slug TEXT NOT NULL UNIQUE,
				status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`
			CREATE TABLE tenant_members (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
				external_identity_id TEXT NOT NULL,
				role TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'active',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				CONSTRAINT uq_member_tenant_identity UNIQUE (tenant_id, external_identity_id)
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_members_tenant_role_status ON tenant_members (tenant_id, role, status)
		`);
		await queryRunner.query(`
			CREATE TABLE audit_records (
				id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
				tenant_id UUID NULL REFERENCES tenants (id) ON DELETE SET NULL,
				actor_type TEXT NOT NULL,
				actor_id TEXT NULL,
				action TEXT NOT NULL,
				resource_type TEXT NOT NULL,
				resource_id TEXT NOT NULL,
				reason TEXT NULL,
				correlation_id TEXT NULL,
				metadata JSONB NOT NULL DEFAULT '{}',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_audit_tenant_created ON audit_records (tenant_id, created_at DESC)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_audit_tenant_resource ON audit_records (tenant_id, resource_type, resource_id, created_at DESC)
		`);
		await queryRunner.query(`
			CREATE INDEX ix_audit_tenant_actor ON audit_records (tenant_id, actor_id, created_at DESC)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("DROP TABLE audit_records");
		await queryRunner.query("DROP TABLE tenant_members");
		await queryRunner.query("DROP TABLE tenants");
	}
}

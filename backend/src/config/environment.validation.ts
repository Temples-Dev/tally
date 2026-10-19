import * as Joi from "joi";

export interface EnvironmentVariables {
	NODE_ENV: "development" | "test" | "staging" | "production";
	PORT: number;
	DATABASE_URL: string;
	CORS_ORIGINS: string;
	LOG_LEVEL: "error" | "warn" | "log" | "debug" | "verbose";
	AUTH_JWT_SECRET: string;
	AUTH_JWT_ISSUER?: string;
	AUTH_JWT_AUDIENCE?: string;
	JOB_POLL_INTERVAL_MS: number;
	JOB_LOCK_TIMEOUT_MS: number;
}

const isLocal = Joi.valid("development", "test");

export const environmentSchema = Joi.object<EnvironmentVariables>({
	NODE_ENV: Joi.string()
		.valid("development", "test", "staging", "production")
		.default("development"),
	PORT: Joi.number().port().default(3000),
	DATABASE_URL: Joi.string()
		.uri({ scheme: ["postgres", "postgresql"] })
		.required(),
	CORS_ORIGINS: Joi.when("NODE_ENV", {
		is: isLocal,
		then: Joi.string().uri().default("http://localhost:5173"),
		otherwise: Joi.string().uri().required(),
	}),
	LOG_LEVEL: Joi.string()
		.valid("error", "warn", "log", "debug", "verbose")
		.default("log"),
	AUTH_JWT_SECRET: Joi.when("NODE_ENV", {
		is: isLocal,
		then: Joi.string().min(16).default("change-me-in-development-only"),
		otherwise: Joi.string().min(32).required(),
	}),
	AUTH_JWT_ISSUER: Joi.string().optional(),
	AUTH_JWT_AUDIENCE: Joi.string().optional(),
	JOB_POLL_INTERVAL_MS: Joi.number().integer().min(50).default(1000),
	JOB_LOCK_TIMEOUT_MS: Joi.number().integer().min(1000).default(300000),
}).unknown();

export function validateEnvironment(
	config: Record<string, unknown>,
): EnvironmentVariables {
	const { error, value } = environmentSchema.validate(config, {
		allowUnknown: true,
	});
	if (error) {
		throw new Error(`Invalid environment configuration: ${error.message}`);
	}
	return value as EnvironmentVariables;
}

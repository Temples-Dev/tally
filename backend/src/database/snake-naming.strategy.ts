import { DefaultNamingStrategy, type NamingStrategyInterface } from "typeorm";

/**
 * Maps camelCase properties to snake_case columns unless an explicit
 * column name is given. Tables keep the explicit names from migrations.
 */
export class SnakeNamingStrategy
	extends DefaultNamingStrategy
	implements NamingStrategyInterface
{
	override columnName(
		propertyName: string,
		customName: string,
		embeddedPrefixes: string[],
	): string {
		if (typeof customName === "string" && customName.length > 0) {
			return customName;
		}
		return [...embeddedPrefixes, propertyName]
			.join("_")
			.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
			.toLowerCase();
	}
}

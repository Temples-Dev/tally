import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "tally:is-public";

/** Marks a route as reachable without authentication (e.g. health checks). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

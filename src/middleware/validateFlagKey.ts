import type { Context, Next } from "hono";
import { FlagKeySchema } from "../schemas/flag.schema";

/**
 * Middleware для валидации параметра :key в URL.
 * При успехе сохраняет валидный ключ в c.set("flagKey", key).
 */
export const validateFlagKey = async (c: Context, next: Next) => {
	const rawKey = c.req.param("key");
	const parsed = FlagKeySchema.safeParse(rawKey);

	if (!parsed.success) {
		return c.json(
			{
				error: {
					code: "bad_request",
					message: "Invalid flag key",
					details: parsed.error.flatten(),
				},
			},
			400,
		);
	}

	c.set("flagKey", parsed.data);
	await next();
};

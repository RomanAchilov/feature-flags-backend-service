// ─────────────────────────────────────────────────────────────────────────────
// Типы
// ─────────────────────────────────────────────────────────────────────────────

export type MutationKind = "create" | "update" | "delete";
export type MutationStatus = "start" | "success" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// Логгер мутаций флагов
// ─────────────────────────────────────────────────────────────────────────────

export const logMutation = (
	kind: MutationKind,
	key: string,
	status: MutationStatus,
	meta: Record<string, unknown> = {},
): void => {
	const payload = { mutation: kind, key, status, ...meta };

	if (status === "error") {
		console.error("[flags]", payload);
	} else {
		console.info("[flags]", payload);
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Хелпер для измерения времени выполнения
// ─────────────────────────────────────────────────────────────────────────────

export const createTimer = () => {
	const startedAt = Date.now();
	return {
		elapsed: () => Date.now() - startedAt,
	};
};

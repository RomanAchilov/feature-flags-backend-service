import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/drizzle";
import { featureFlagEnvironments, featureFlags } from "../db/schema";
import { handleDrizzleError } from "../errors/drizzleErrorHandler";
import { logFlagChange } from "../repositories/featureFlagAuditRepository";
import {
	createFlag,
	deleteFlagByKey,
	type FlagWithRelations,
	fetchFlagWithRelations,
	updateFlagByKey,
} from "../repositories/featureFlagRepository";
import type { CreateFlagInput, UpdateFlagInput } from "../schemas/flag.schema";
import { createTimer, logMutation } from "../utils/flagLogger";
import {
	badRequestError,
	conflictError,
	err,
	internalError,
	notFoundError,
	ok,
	type ServiceResult,
} from "../utils/responses";
import {
	replaceSegmentTargets,
	upsertSegmentTargets,
} from "./flagTargetService";

// ─────────────────────────────────────────────────────────────────────────────
// Типы результатов
// ─────────────────────────────────────────────────────────────────────────────

type ToggleResult = {
	key: string;
	environment: "development" | "staging" | "production";
	enabled: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Создание флага
// ─────────────────────────────────────────────────────────────────────────────

export const createFlagWithTargets = async (
	input: CreateFlagInput,
	userId: string,
): Promise<ServiceResult<FlagWithRelations>> => {
	const { key, segmentTargets, ...flagData } = input;

	try {
		logMutation("create", key, "start");

		const createdFlag = await db.transaction(async (tx) => {
			const created = await createFlag({ key, ...flagData }, tx);

			if (segmentTargets && segmentTargets.length > 0) {
				await upsertSegmentTargets(created.id, segmentTargets, tx);
			}

			await logFlagChange(
				{
					flagId: created.id,
					action: "create",
					changedBy: userId,
					before: null,
					after: created,
				},
				tx,
			);

			const hydrated = await fetchFlagWithRelations(created.key, tx, {
				allowFallback: true,
				fallbackClient: db,
			});
			if (!hydrated) {
				throw new Error("Created flag could not be loaded");
			}
			return hydrated;
		});

		logMutation("create", key, "success");
		return ok(createdFlag);
	} catch (error) {
		logMutation("create", key, "error", {
			message: error instanceof Error ? error.message : String(error),
		});
		console.error("Failed to create flag", error);

		return mapDrizzleErrorToResult(error, "Failed to create flag");
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Получение флага
// ─────────────────────────────────────────────────────────────────────────────

export const getFlagByKeyWithRelations = async (
	key: string,
): Promise<ServiceResult<FlagWithRelations>> => {
	try {
		const flag = await fetchFlagWithRelations(key, db, {
			allowFallback: true,
		});

		if (!flag) {
			return err(notFoundError("Flag not found"));
		}

		return ok(flag);
	} catch (error) {
		console.error("Failed to get flag", error);
		return err(internalError("Failed to get flag"));
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Обновление флага
// ─────────────────────────────────────────────────────────────────────────────

export const updateFlagWithTargets = async (
	key: string,
	input: UpdateFlagInput,
	userId: string,
): Promise<ServiceResult<FlagWithRelations>> => {
	const { segmentTargets, ...updateData } = input;
	const timer = createTimer();

	try {
		logMutation("update", key, "start", {
			user: userId,
			envs: updateData.environments?.length ?? 0,
			segmentTargets: segmentTargets?.length ?? 0,
		});

		const result = await db.transaction(async (tx) => {
			const before = await fetchFlagWithRelations(key, tx, {
				allowFallback: true,
				fallbackClient: db,
			});
			if (!before) return null;

			const updated = await updateFlagByKey(key, updateData, tx);
			if (!updated) return null;

			if (segmentTargets) {
				await replaceSegmentTargets(updated.id, segmentTargets, tx);
			}

			// Всегда загружаем полные relations для консистентного типа
			const hydrated = await fetchFlagWithRelations(key, tx, {
				allowFallback: true,
				fallbackClient: db,
			});

			if (!hydrated) return null;

			await logFlagChange(
				{
					flagId: updated.id,
					action: "update",
					changedBy: userId,
					before,
					after: hydrated,
				},
				tx,
			);

			return hydrated;
		});

		if (!result) {
			return err(notFoundError("Flag not found"));
		}

		logMutation("update", key, "success", { elapsedMs: timer.elapsed() });
		return ok(result);
	} catch (error) {
		logMutation("update", key, "error", { elapsedMs: timer.elapsed() });
		console.error("Failed to update flag", error);

		return mapDrizzleErrorToResult(error, "Failed to update flag");
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Переключение окружения
// ─────────────────────────────────────────────────────────────────────────────

export const toggleFlagEnvironment = async (
	key: string,
	environment: "development" | "staging" | "production",
	enabled: boolean,
	userId: string,
): Promise<ServiceResult<ToggleResult>> => {
	const timer = createTimer();

	try {
		logMutation("update", key, "start", {
			env: environment,
			enabled,
			user: userId,
			mode: "env-toggle",
		});

		const result = await db.transaction(async (tx) => {
			const flags = await tx
				.select({
					id: featureFlags.id,
					key: featureFlags.key,
				})
				.from(featureFlags)
				.where(and(eq(featureFlags.key, key), isNull(featureFlags.deletedAt)))
				.limit(1);

			if (flags.length === 0) {
				return null;
			}

			const flag = flags[0];

			const envs = await tx
				.select({
					id: featureFlagEnvironments.id,
					environment: featureFlagEnvironments.environment,
					enabled: featureFlagEnvironments.enabled,
				})
				.from(featureFlagEnvironments)
				.where(
					and(
						eq(featureFlagEnvironments.flagId, flag.id),
						eq(featureFlagEnvironments.environment, environment),
					),
				)
				.limit(1);

			if (envs.length === 0) {
				return null;
			}

			const env = envs[0];

			const [updatedEnv] = await tx
				.update(featureFlagEnvironments)
				.set({ enabled, updatedAt: new Date() })
				.where(eq(featureFlagEnvironments.id, env.id))
				.returning({
					id: featureFlagEnvironments.id,
					environment: featureFlagEnvironments.environment,
					enabled: featureFlagEnvironments.enabled,
				});

			await logFlagChange(
				{
					flagId: flag.id,
					action: "update",
					changedBy: userId,
					before: { environment: env.environment, enabled: env.enabled },
					after: {
						environment: updatedEnv.environment,
						enabled: updatedEnv.enabled,
					},
				},
				tx,
			);

			return {
				key: flag.key,
				environment: updatedEnv.environment,
				enabled: updatedEnv.enabled,
			};
		});

		if (!result) {
			return err(notFoundError("Flag or environment not found"));
		}

		logMutation("update", key, "success", {
			mode: "env-toggle",
			env: environment,
			elapsedMs: timer.elapsed(),
		});

		return ok(result);
	} catch (error) {
		logMutation("update", key, "error", {
			mode: "env-toggle",
			env: environment,
			elapsedMs: timer.elapsed(),
		});
		console.error("Failed to toggle environment", error);

		return mapDrizzleErrorToResult(error, "Failed to toggle environment");
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Удаление флага (soft delete)
// ─────────────────────────────────────────────────────────────────────────────

export const softDeleteFlag = async (
	key: string,
	userId: string,
): Promise<ServiceResult<{ deleted: true }>> => {
	try {
		const existing = await fetchFlagWithRelations(key);
		if (!existing) {
			return err(notFoundError("Flag not found"));
		}

		const deleted = await deleteFlagByKey(key);
		if (!deleted) {
			return err(notFoundError("Flag not found"));
		}

		await logFlagChange({
			flagId: existing.id,
			action: "delete",
			changedBy: userId,
			before: existing,
			after: null,
		});

		return ok({ deleted: true });
	} catch (error) {
		console.error("Failed to delete flag", error);
		return err(internalError("Failed to delete flag"));
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Хелперы
// ─────────────────────────────────────────────────────────────────────────────

const mapDrizzleErrorToResult = <T>(
	error: unknown,
	fallbackMessage: string,
): ServiceResult<T> => {
	const handled = handleDrizzleError(error);

	if (handled) {
		if (handled.status === 409) {
			return err(conflictError(handled.body.error.message));
		}
		const details: Record<string, unknown> = {};
		if (handled.body.error.field) {
			details.field = handled.body.error.field;
		}
		if (handled.body.error.table) {
			details.table = handled.body.error.table;
		}
		return err(
			badRequestError(
				handled.body.error.message,
				Object.keys(details).length > 0 ? details : undefined,
			),
		);
	}

	return err(internalError(fallbackMessage));
};

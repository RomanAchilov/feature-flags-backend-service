import {
	type FeatureEnvironment,
	FeatureFlagAuditAction,
	Prisma,
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { handlePrismaError } from "../errors/prismaErrorHandler";
import { logFlagChange } from "../repositories/featureFlagAuditRepository";
import {
	FLAG_WITH_RELATIONS_INCLUDE,
	type FlagWithRelations,
	createFlag,
	deleteFlagByKey,
	fetchFlagWithRelations,
	updateFlagByKey,
} from "../repositories/featureFlagRepository";
import type { CreateFlagInput, UpdateFlagInput } from "../schemas/flag.schema";
import {
	type ServiceResult,
	badRequestError,
	conflictError,
	err,
	internalError,
	notFoundError,
	ok,
} from "../utils/responses";
import {
	replaceSegmentTargets,
	replaceUserTargets,
	upsertSegmentTargets,
	upsertUserTargets,
} from "./flagTargetService";
import { createTimer, logMutation } from "../utils/flagLogger";

// ─────────────────────────────────────────────────────────────────────────────
// Типы результатов
// ─────────────────────────────────────────────────────────────────────────────

type ToggleResult = {
	key: string;
	environment: FeatureEnvironment;
	enabled: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Создание флага
// ─────────────────────────────────────────────────────────────────────────────

export const createFlagWithTargets = async (
	input: CreateFlagInput,
	userId: string,
): Promise<ServiceResult<FlagWithRelations>> => {
	const { key, userTargets, segmentTargets, ...flagData } = input;

	try {
		logMutation("create", key, "start");

		const createdFlag = await prisma.$transaction(
			async (tx) => {
				const created = await createFlag({ key, ...flagData }, tx);

				if (userTargets && userTargets.length > 0) {
					await upsertUserTargets(created.id, userTargets, tx);
				}
				if (segmentTargets && segmentTargets.length > 0) {
					await upsertSegmentTargets(created.id, segmentTargets, tx);
				}

				await logFlagChange(
					{
						flagId: created.id,
						action: FeatureFlagAuditAction.create,
						changedBy: userId,
						before: null,
						after: created,
					},
					tx,
				);

				const hydrated = await fetchFlagWithRelations(created.key, tx, {
					allowFallback: true,
					fallbackClient: prisma,
				});
				if (!hydrated) {
					throw new Error("Created flag could not be loaded");
				}
				return hydrated;
			},
			{ timeout: 15000 },
		);

		logMutation("create", key, "success");
		return ok(createdFlag);
	} catch (error) {
		logMutation("create", key, "error", {
			message: error instanceof Error ? error.message : String(error),
		});
		console.error("Failed to create flag", error);

		return mapPrismaErrorToResult(error, "Failed to create flag");
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Получение флага
// ─────────────────────────────────────────────────────────────────────────────

export const getFlagByKeyWithRelations = async (
	key: string,
): Promise<ServiceResult<FlagWithRelations>> => {
	try {
		const flag = await fetchFlagWithRelations(key, prisma, {
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
	const { userTargets, segmentTargets, ...updateData } = input;
	const timer = createTimer();

	try {
		logMutation("update", key, "start", {
			user: userId,
			envs: updateData.environments?.length ?? 0,
			userTargets: userTargets?.length ?? 0,
			segmentTargets: segmentTargets?.length ?? 0,
		});

		const result = await prisma.$transaction(
			async (tx) => {
				const before = await fetchFlagWithRelations(key, tx, {
					allowFallback: true,
					fallbackClient: prisma,
				});
				if (!before) return null;

				const updated = await updateFlagByKey(
					key,
					updateData,
					tx,
					FLAG_WITH_RELATIONS_INCLUDE,
				);
				if (!updated) return null;

				if (userTargets) {
					await replaceUserTargets(updated.id, userTargets, tx);
				}
				if (segmentTargets) {
					await replaceSegmentTargets(updated.id, segmentTargets, tx);
				}

				// Всегда загружаем полные relations для консистентного типа
				const hydrated = await fetchFlagWithRelations(key, tx, {
					allowFallback: true,
					fallbackClient: prisma,
				});

				if (!hydrated) return null;

				await logFlagChange(
					{
						flagId: updated.id,
						action: FeatureFlagAuditAction.update,
						changedBy: userId,
						before,
						after: hydrated,
					},
					tx,
				);

				return hydrated;
			},
			{ timeout: 15000 },
		);

		if (!result) {
			return err(notFoundError("Flag not found"));
		}

		logMutation("update", key, "success", { elapsedMs: timer.elapsed() });
		return ok(result);
	} catch (error) {
		logMutation("update", key, "error", { elapsedMs: timer.elapsed() });
		console.error("Failed to update flag", error);

		return mapPrismaErrorToResult(error, "Failed to update flag");
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Переключение окружения
// ─────────────────────────────────────────────────────────────────────────────

export const toggleFlagEnvironment = async (
	key: string,
	environment: FeatureEnvironment,
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

		const result = await prisma.$transaction(
			async (tx) => {
				const flag = await tx.featureFlag.findFirst({
					where: { key, deletedAt: null },
					select: {
						id: true,
						key: true,
						environments: {
							where: { environment },
							select: { id: true, environment: true, enabled: true },
						},
					},
				});

				if (!flag || flag.environments.length === 0) {
					return null;
				}

				const env = flag.environments[0];
				const updatedEnv = await tx.featureFlagEnvironment.update({
					where: { id: env.id },
					data: { enabled },
					select: { id: true, environment: true, enabled: true },
				});

				await logFlagChange(
					{
						flagId: flag.id,
						action: FeatureFlagAuditAction.update,
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
			},
			{ timeout: 10000 },
		);

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

		return mapPrismaErrorToResult(error, "Failed to toggle environment");
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
			action: FeatureFlagAuditAction.delete,
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

const mapPrismaErrorToResult = <T>(
	error: unknown,
	fallbackMessage: string,
): ServiceResult<T> => {
	const handled = handlePrismaError(error);

	if (handled) {
		if (handled.status === 409) {
			return err(conflictError(handled.body.error.message));
		}
		return err(badRequestError(handled.body.error.message));
	}

	if (error instanceof Prisma.PrismaClientKnownRequestError) {
		return err(badRequestError("Database operation failed"));
	}

	return err(internalError(fallbackMessage));
};


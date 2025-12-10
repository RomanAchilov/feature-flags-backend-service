import { createId } from "@paralleldrive/cuid2";
import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const featureEnvironmentEnum = pgEnum("FeatureEnvironment", [
	"development",
	"staging",
	"production",
]);

export const featureFlagTypeEnum = pgEnum("FeatureFlagType", [
	"BOOLEAN",
	"MULTIVARIANT",
]);

export const featureFlagAuditActionEnum = pgEnum("FeatureFlagAuditAction", [
	"create",
	"update",
	"delete",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

export const featureFlags = pgTable(
	"FeatureFlag",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		name: text("name").notNull(),
		key: text("key").notNull().unique(),
		description: text("description"),
		type: featureFlagTypeEnum("type").notNull().default("BOOLEAN"),
		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updatedAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
		deletedAt: timestamp("deletedAt", { withTimezone: true }),
	},
	(table) => ({
		keyIdx: unique().on(table.key),
	}),
);

export const featureFlagEnvironments = pgTable(
	"FeatureFlagEnvironment",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		flagId: text("flagId")
			.notNull()
			.references(() => featureFlags.id, { onDelete: "cascade" }),
		environment: featureEnvironmentEnum("environment").notNull(),
		enabled: boolean("enabled").notNull().default(false),
		rolloutPercentage: integer("rolloutPercentage"),
		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updatedAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		flagIdIdx: index("FeatureFlagEnvironment_flagId_idx").on(table.flagId),
		flagEnvironmentUnique: unique().on(table.flagId, table.environment),
	}),
);

export const featureFlagUserTargets = pgTable(
	"FeatureFlagUserTarget",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		flagEnvironmentId: text("flagEnvironmentId")
			.notNull()
			.references(() => featureFlagEnvironments.id, { onDelete: "cascade" }),
		userId: text("userId").notNull(),
		include: boolean("include").notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		flagEnvironmentIdIdx: index(
			"FeatureFlagUserTarget_flagEnvironmentId_idx",
		).on(table.flagEnvironmentId),
		flagEnvironmentUserIdUnique: unique().on(
			table.flagEnvironmentId,
			table.userId,
		),
	}),
);

export const featureFlagSegmentTargets = pgTable(
	"FeatureFlagSegmentTarget",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		flagEnvironmentId: text("flagEnvironmentId")
			.notNull()
			.references(() => featureFlagEnvironments.id, { onDelete: "cascade" }),
		segment: text("segment").notNull(),
		include: boolean("include").notNull(),
		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		flagEnvironmentIdIdx: index(
			"FeatureFlagSegmentTarget_flagEnvironmentId_idx",
		).on(table.flagEnvironmentId),
		segmentIdx: index("FeatureFlagSegmentTarget_segment_idx").on(table.segment),
		flagEnvironmentSegmentUnique: unique().on(
			table.flagEnvironmentId,
			table.segment,
		),
	}),
);

export const featureSegmentDefinitions = pgTable(
	"FeatureSegmentDefinition",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		name: text("name").notNull().unique(),
		createdAt: timestamp("createdAt", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(table) => ({
		nameUnique: unique().on(table.name),
	}),
);

export const featureFlagAuditLogs = pgTable(
	"FeatureFlagAuditLog",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => createId()),
		flagId: text("flagId")
			.notNull()
			.references(() => featureFlags.id, { onDelete: "cascade" }),
		timestamp: timestamp("timestamp", { withTimezone: true })
			.notNull()
			.defaultNow(),
		changedBy: text("changedBy").notNull(),
		action: featureFlagAuditActionEnum("action").notNull(),
		before: jsonb("before"),
		after: jsonb("after"),
	},
	(table) => ({
		flagIdIdx: index("FeatureFlagAuditLog_flagId_idx").on(table.flagId),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────────

export const featureFlagsRelations = relations(featureFlags, ({ many }) => ({
	environments: many(featureFlagEnvironments),
	auditLogs: many(featureFlagAuditLogs),
}));

export const featureFlagEnvironmentsRelations = relations(
	featureFlagEnvironments,
	({ one, many }) => ({
		flag: one(featureFlags, {
			fields: [featureFlagEnvironments.flagId],
			references: [featureFlags.id],
		}),
		userTargets: many(featureFlagUserTargets),
		segmentTargets: many(featureFlagSegmentTargets),
	}),
);

export const featureFlagUserTargetsRelations = relations(
	featureFlagUserTargets,
	({ one }) => ({
		environment: one(featureFlagEnvironments, {
			fields: [featureFlagUserTargets.flagEnvironmentId],
			references: [featureFlagEnvironments.id],
		}),
	}),
);

export const featureFlagSegmentTargetsRelations = relations(
	featureFlagSegmentTargets,
	({ one }) => ({
		environment: one(featureFlagEnvironments, {
			fields: [featureFlagSegmentTargets.flagEnvironmentId],
			references: [featureFlagEnvironments.id],
		}),
	}),
);

export const featureFlagAuditLogsRelations = relations(
	featureFlagAuditLogs,
	({ one }) => ({
		flag: one(featureFlags, {
			fields: [featureFlagAuditLogs.flagId],
			references: [featureFlags.id],
		}),
	}),
);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;

export type FeatureFlagEnvironment =
	typeof featureFlagEnvironments.$inferSelect;
export type NewFeatureFlagEnvironment =
	typeof featureFlagEnvironments.$inferInsert;

export type FeatureFlagUserTarget = typeof featureFlagUserTargets.$inferSelect;
export type NewFeatureFlagUserTarget =
	typeof featureFlagUserTargets.$inferInsert;

export type FeatureFlagSegmentTarget =
	typeof featureFlagSegmentTargets.$inferSelect;
export type NewFeatureFlagSegmentTarget =
	typeof featureFlagSegmentTargets.$inferInsert;

export type FeatureSegmentDefinition =
	typeof featureSegmentDefinitions.$inferSelect;
export type NewFeatureSegmentDefinition =
	typeof featureSegmentDefinitions.$inferInsert;

export type FeatureFlagAuditLog = typeof featureFlagAuditLogs.$inferSelect;
export type NewFeatureFlagAuditLog = typeof featureFlagAuditLogs.$inferInsert;

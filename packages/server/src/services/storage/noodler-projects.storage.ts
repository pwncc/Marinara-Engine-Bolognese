import { asc, eq } from "../../db/file-query.js";
import { noodleAccounts, noodlerCreatorProjects, noodlerProjectMilestones } from "../../db/schema/index.js";
import type { DB } from "../../db/connection.js";
import { newId, now } from "../../utils/id-generator.js";
import type {
  NoodlerCreatorProject,
  NoodlerCreatorProjectDetail,
  NoodlerProjectMilestone,
} from "@marinara-engine/shared";
import type {
  noodlerMilestoneCreateSchema,
  noodlerMilestoneUpdateSchema,
  noodlerProjectCreateSchema,
  noodlerProjectUpdateSchema,
} from "@marinara-engine/shared";
import type { z } from "zod";

type ProjectInput = z.infer<typeof noodlerProjectCreateSchema>;
type ProjectPatch = z.infer<typeof noodlerProjectUpdateSchema>;
type MilestoneInput = z.infer<typeof noodlerMilestoneCreateSchema>;
type MilestonePatch = z.infer<typeof noodlerMilestoneUpdateSchema>;
type ProjectRow = typeof noodlerCreatorProjects.$inferSelect;
type MilestoneRow = typeof noodlerProjectMilestones.$inferSelect;

function project(row: ProjectRow): NoodlerCreatorProject {
  return {
    ...row,
    influence: row.influence === "loose" || row.influence === "focused" ? row.influence : "balanced",
    status:
      row.status === "active" || row.status === "paused" || row.status === "completed" || row.status === "archived"
        ? row.status
        : "draft",
  };
}

function milestone(row: MilestoneRow): NoodlerProjectMilestone {
  return {
    ...row,
    status:
      row.status === "ready" || row.status === "completed" || row.status === "skipped" ? row.status : "planned",
    access: row.access === "public" || row.access === "ppv" ? row.access : "subscriber",
    mediaPreference:
      row.mediaPreference === "text" ||
      row.mediaPreference === "image" ||
      row.mediaPreference === "text_and_image"
        ? row.mediaPreference
        : "model_choice",
  };
}

export function createNoodlerProjectsStorage(db: DB) {
  return {
    async list(creatorAccountId: string): Promise<NoodlerCreatorProjectDetail[]> {
      const rows = await db
        .select()
        .from(noodlerCreatorProjects)
        .where(eq(noodlerCreatorProjects.creatorAccountId, creatorAccountId))
        .orderBy(asc(noodlerCreatorProjects.createdAt));
      return Promise.all(rows.map((row) => this.getDetail(row.id))).then((items) => items.filter(Boolean) as NoodlerCreatorProjectDetail[]);
    },

    async getDetail(id: string): Promise<NoodlerCreatorProjectDetail | null> {
      const rows = await db.select().from(noodlerCreatorProjects).where(eq(noodlerCreatorProjects.id, id));
      if (!rows[0]) return null;
      const milestones = await db
        .select()
        .from(noodlerProjectMilestones)
        .where(eq(noodlerProjectMilestones.projectId, id))
        .orderBy(asc(noodlerProjectMilestones.position));
      return { project: project(rows[0]), milestones: milestones.map(milestone) };
    },

    async create(creatorAccountId: string, input: ProjectInput): Promise<NoodlerCreatorProjectDetail | null> {
      const accounts = await db.select().from(noodleAccounts).where(eq(noodleAccounts.id, creatorAccountId));
      if (accounts[0]?.visibility !== "private") return null;
      const timestamp = now();
      const id = newId();
      await db.insert(noodlerCreatorProjects).values({
        id,
        creatorAccountId,
        ...input,
        lastGeneratedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return this.getDetail(id);
    },

    async update(id: string, patch: ProjectPatch): Promise<NoodlerCreatorProjectDetail | null> {
      const current = await this.getDetail(id);
      if (!current) return null;
      if (
        (current.project.status === "completed" || current.project.status === "archived") &&
        patch.status === "active"
      )
        return null;
      await db.update(noodlerCreatorProjects).set({ ...patch, updatedAt: now() }).where(eq(noodlerCreatorProjects.id, id));
      return this.getDetail(id);
    },

    async addMilestone(projectId: string, input: MilestoneInput): Promise<NoodlerProjectMilestone | null> {
      const detail = await this.getDetail(projectId);
      if (!detail) return null;
      const timestamp = now();
      const id = newId();
      await db.insert(noodlerProjectMilestones).values({
        id,
        projectId,
        ...input,
        position: detail.milestones.length,
        generatedPostId: null,
        completionSummary: "",
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const rows = await db.select().from(noodlerProjectMilestones).where(eq(noodlerProjectMilestones.id, id));
      return rows[0] ? milestone(rows[0]) : null;
    },

    async updateMilestone(projectId: string, id: string, patch: MilestonePatch): Promise<NoodlerProjectMilestone | null> {
      const rows = await db.select().from(noodlerProjectMilestones).where(eq(noodlerProjectMilestones.id, id));
      if (!rows[0] || rows[0].projectId !== projectId) return null;
      if (rows[0].status === "completed" && patch.status && patch.status !== "completed") return null;
      await db.update(noodlerProjectMilestones).set({ ...patch, updatedAt: now() }).where(eq(noodlerProjectMilestones.id, id));
      const updated = await db.select().from(noodlerProjectMilestones).where(eq(noodlerProjectMilestones.id, id));
      return updated[0] ? milestone(updated[0]) : null;
    },

    async nextMilestone(projectId: string, at = new Date()): Promise<NoodlerProjectMilestone | null> {
      const detail = await this.getDetail(projectId);
      if (!detail || detail.project.status !== "active") return null;
      return (
        detail.milestones.find(
          (item) =>
            (item.status === "planned" || item.status === "ready") &&
            (!item.notBefore || Date.parse(item.notBefore) <= at.getTime()),
        ) ?? null
      );
    },

    async automaticMilestone(creatorAccountId: string, at = new Date()) {
      const details = await this.list(creatorAccountId);
      for (const detail of details) {
        const project = detail.project;
        if (project.status !== "active") continue;
        if (project.startsAt && Date.parse(project.startsAt) > at.getTime()) continue;
        if (project.endsAt && Date.parse(project.endsAt) < at.getTime()) continue;
        if (
          project.minimumSpacingHours !== null &&
          project.lastGeneratedAt &&
          Date.parse(project.lastGeneratedAt) + project.minimumSpacingHours * 60 * 60 * 1000 > at.getTime()
        )
          continue;
        const milestone = detail.milestones.find(
          (item) =>
            (item.status === "ready" ||
              (item.status === "planned" && item.dueAt !== null && Date.parse(item.dueAt) <= at.getTime())) &&
            (!item.notBefore || Date.parse(item.notBefore) <= at.getTime()),
        );
        if (milestone) return { project, milestone };
      }
      return null;
    },

    async completeMilestone(projectId: string, milestoneId: string, postId: string, summary: string) {
      const timestamp = now();
      await db.transaction(async (tx) => {
        await tx
          .update(noodlerProjectMilestones)
          .set({
            status: "completed",
            generatedPostId: postId,
            completionSummary: summary.slice(0, 500),
            completedAt: timestamp,
            updatedAt: timestamp,
          })
          .where(eq(noodlerProjectMilestones.id, milestoneId));
        await tx
          .update(noodlerCreatorProjects)
          .set({ lastGeneratedAt: timestamp, updatedAt: timestamp })
          .where(eq(noodlerCreatorProjects.id, projectId));
      });
      return this.getDetail(projectId);
    },
  };
}

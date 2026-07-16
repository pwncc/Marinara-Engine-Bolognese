import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Loader2, Pause, Play, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateNoodlerMilestone,
  useCreateNoodlerProject,
  useGenerateNextNoodlerProjectPost,
  useNoodlerProjects,
  useUpdateNoodlerMilestone,
  useUpdateNoodlerProject,
} from "../../hooks/use-noodler";

export function NoodlerProjectsPanel({ accountId }: { accountId: string }) {
  const projectsQuery = useNoodlerProjects(accountId);
  const createProject = useCreateNoodlerProject(accountId);
  const updateProject = useUpdateNoodlerProject(accountId);
  const createMilestone = useCreateNoodlerMilestone(accountId);
  const updateMilestone = useUpdateNoodlerMilestone(accountId);
  const generateNext = useGenerateNextNoodlerProjectPost(accountId);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [milestoneDrafts, setMilestoneDrafts] = useState<Record<string, string>>({});
  const projects = projectsQuery.data ?? [];

  const addProject = async () => {
    if (!title.trim()) return;
    try {
      await createProject.mutateAsync({
        title: title.trim(),
        brief: brief.trim(),
        toneGuidance: "",
        influence: "balanced",
        status: "draft",
        startsAt: null,
        endsAt: null,
        minimumSpacingHours: null,
      });
      setTitle("");
      setBrief("");
      toast.success("Creator project added.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the creator project.");
    }
  };

  return (
    <section className="space-y-3 border-t border-[var(--noodle-divider)] pt-4" data-component="NoodlerProjectsPanel">
      <div>
        <h3 className="text-sm font-bold text-[var(--foreground)]">Creator projects</h3>
        <p className="mt-1 max-w-[68ch] text-xs leading-5 text-[var(--muted-foreground)]">
          Give this creator an evolving posting arc. Milestones guide the next generated post without writing it for them.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto]">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Project title"
          maxLength={120}
          className="h-9 rounded-md border border-[var(--noodle-divider)] bg-[var(--background)] px-3 text-xs"
        />
        <input
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="What is the creator working toward?"
          maxLength={4000}
          className="h-9 rounded-md border border-[var(--noodle-divider)] bg-[var(--background)] px-3 text-xs"
        />
        <button
          type="button"
          onClick={() => void addProject()}
          disabled={!title.trim() || createProject.isPending}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--noodle-blue)] px-3 text-xs font-bold text-white disabled:opacity-50"
        >
          {createProject.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
        </button>
      </div>

      {projectsQuery.isLoading && <Loader2 size={16} className="animate-spin text-[var(--noodle-blue)]" />}
      {projects.map(({ project, milestones }) => {
        const next = milestones.find((item) => item.status === "ready" || item.status === "planned");
        const active = project.status === "active";
        const terminal = project.status === "completed" || project.status === "archived";
        return (
          <article key={project.id} className="rounded-lg border border-[var(--noodle-divider)] bg-[var(--background)] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-bold text-[var(--foreground)]">{project.title}</h4>
                  <span className="rounded-full bg-[var(--noodle-blue)]/10 px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--noodle-blue)]">
                    {project.status}
                  </span>
                  <span className="text-[0.68rem] text-[var(--muted-foreground)]">
                    {milestones.filter((item) => item.status === "completed").length}/{milestones.length} beats
                  </span>
                </div>
                {project.brief && <p className="mt-1 text-xs leading-5 text-[var(--muted-foreground)]">{project.brief}</p>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <select
                  value={project.influence}
                  onChange={(event) =>
                    updateProject.mutate({
                      id: project.id,
                      patch: { influence: event.target.value as "loose" | "balanced" | "focused" },
                    })
                  }
                  className="h-8 rounded-md border border-[var(--noodle-divider)] bg-[var(--background)] px-2 text-xs"
                  aria-label="Project influence"
                >
                  <option value="loose">Loose</option>
                  <option value="balanced">Balanced</option>
                  <option value="focused">Focused</option>
                </select>
                <button
                  type="button"
                  onClick={() => updateProject.mutate({ id: project.id, patch: { status: active ? "paused" : "active" } })}
                  disabled={terminal}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--noodle-divider)] px-2 text-xs font-semibold disabled:opacity-45"
                >
                  {active ? <Pause size={12} /> : <Play size={12} />} {active ? "Pause" : "Activate"}
                </button>
                {!terminal && (
                  <button
                    type="button"
                    onClick={() => updateProject.mutate({ id: project.id, patch: { status: "completed" } })}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--noodle-divider)] px-2 text-xs font-semibold"
                  >
                    <Check size={12} /> Complete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => updateProject.mutate({ id: project.id, patch: { status: "archived" } })}
                  disabled={project.status === "archived"}
                  className="inline-flex h-8 items-center rounded-md border border-[var(--noodle-divider)] px-2 text-xs font-semibold disabled:opacity-45"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() =>
                    generateNext.mutate(project.id, {
                      onSuccess: () => toast.success("The next project post was published."),
                      onError: (error) => toast.error(error instanceof Error ? error.message : "Could not generate the post."),
                    })
                  }
                  disabled={!active || !next || generateNext.isPending}
                  className="inline-flex h-8 items-center gap-1 rounded-md bg-[var(--noodle-blue)] px-2.5 text-xs font-bold text-white disabled:opacity-45"
                >
                  {generateNext.isPending ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Generate next
                </button>
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              {milestones.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2 rounded-md bg-[var(--muted)]/35 px-2.5 py-2 text-xs">
                  <span className="w-5 shrink-0 text-center font-semibold text-[var(--muted-foreground)]">{index + 1}</span>
                  <span className={item.status === "completed" || item.status === "skipped" ? "flex-1 line-through opacity-60" : "flex-1"}>
                    {item.title}
                  </span>
                  {item.status === "completed" && <Check size={13} className="text-[var(--noodle-blue)]" />}
                  {item.status !== "completed" && (
                    <button
                    type="button"
                    title="Mark ready"
                    onClick={() => updateMilestone.mutate({ projectId: project.id, id: item.id, patch: { status: "ready" } })}
                    className="rounded p-1 hover:bg-[var(--accent)]"
                  >
                    <ChevronUp size={13} />
                  </button>
                  )}
                  {item.status !== "completed" && item.status !== "skipped" && (
                    <select
                      value={item.access}
                      onChange={(event) =>
                        updateMilestone.mutate({
                          projectId: project.id,
                          id: item.id,
                          patch: { access: event.target.value as "public" | "subscriber" | "ppv" },
                        })
                      }
                      className="h-7 rounded border border-[var(--noodle-divider)] bg-[var(--background)] px-1.5 text-[0.68rem]"
                      aria-label="Milestone access"
                    >
                      <option value="public">Public preview</option>
                      <option value="subscriber">Subscriber</option>
                      <option value="ppv">PPV</option>
                    </select>
                  )}
                  {item.status !== "completed" && item.status !== "skipped" && (
                    <select
                      value={item.mediaPreference}
                      onChange={(event) =>
                        updateMilestone.mutate({
                          projectId: project.id,
                          id: item.id,
                          patch: {
                            mediaPreference: event.target.value as "text" | "image" | "text_and_image" | "model_choice",
                          },
                        })
                      }
                      className="h-7 rounded border border-[var(--noodle-divider)] bg-[var(--background)] px-1.5 text-[0.68rem]"
                      aria-label="Milestone media"
                    >
                      <option value="model_choice">Model choice</option>
                      <option value="text">Text</option>
                      <option value="image">Image</option>
                      <option value="text_and_image">Text + image</option>
                    </select>
                  )}
                  {item.status !== "completed" && (
                    <button
                    type="button"
                    title="Skip milestone"
                    onClick={() => updateMilestone.mutate({ projectId: project.id, id: item.id, patch: { status: "skipped" } })}
                    className="rounded p-1 hover:bg-[var(--accent)]"
                  >
                    <ChevronDown size={13} />
                  </button>
                  )}
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <input
                  value={milestoneDrafts[project.id] ?? ""}
                  onChange={(event) => setMilestoneDrafts((current) => ({ ...current, [project.id]: event.target.value }))}
                  placeholder="Add the next posting beat"
                  maxLength={240}
                  className="h-8 min-w-0 flex-1 rounded-md border border-[var(--noodle-divider)] bg-[var(--background)] px-2.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    const value = milestoneDrafts[project.id]?.trim();
                    if (!value) return;
                    createMilestone.mutate(
                      {
                        projectId: project.id,
                        input: {
                          title: value,
                          notes: "",
                          status: "planned",
                          notBefore: null,
                          dueAt: null,
                          access: "subscriber",
                          ppvPrice: null,
                          mediaPreference: "model_choice",
                        },
                      },
                      { onSuccess: () => setMilestoneDrafts((current) => ({ ...current, [project.id]: "" })) },
                    );
                  }}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-[var(--noodle-divider)] px-2.5 text-xs font-semibold"
                >
                  <Plus size={12} /> Beat
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

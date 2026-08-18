/** All model-facing strings for the subagents tools. */

/** Describes subagent_spawn: declared intent, routed model, fixed concurrency cap. */
export const SUBAGENT_SPAWN_TOOL_DESCRIPTION =
  "Spawn a background subagent: a fully autonomous, headless pi session with its own context window and this environment's normal tools and permissions. Declare the task's intent with `effort` (and `needs` when the task has hard requirements); the router picks the best available model for that intent on this machine. Do not pick a model yourself unless the user names one. Fire-and-forget: this returns immediately with an id. The subagent's final output is queued back to you as a message when it settles, or collect it explicitly with subagent_wait. Children cannot orchestrate more agents/workflows or ask the user, and cannot see this conversation, so the prompt must be self-contained. Only use trusted working directories. Max 4 subagents can be running at once.";

/** Adds background subagent delegation to the parent model's available-tools prompt. */
export const SUBAGENT_SPAWN_PROMPT_SNIPPET =
  "Spawn a background subagent for a self-contained task, declaring effort (quick/standard/deep) instead of a model";

/** Guides the parent model to delegate standalone tasks and avoid unnecessary blocking waits. */
export const SUBAGENT_SPAWN_PROMPT_GUIDELINES = [
  "Use subagent_spawn to delegate self-contained tasks that can run in the background; give it a complete, standalone prompt.",
  'Choose `effort` by the task, not the model: "quick" for mechanical lookups and small edits, "standard" for ordinary implementation, "deep" for planning, architecture, and hard debugging.',
  "Add `needs` only for hard requirements the task genuinely has (a large codebase to read, images to look at, sustained reasoning). Every entry narrows the candidate models.",
  "After subagent_spawn, keep working; results arrive automatically. Only call subagent_wait when you cannot proceed without the result.",
];

/** Model-facing schema descriptions for subagent_spawn task and routing options. */
export const SUBAGENT_SPAWN_PARAMETER_DESCRIPTIONS = {
  prompt:
    "Task prompt for the subagent. Must be self-contained: include all needed context, file paths, and what to report back.",
  name: "Short human-readable name for this subagent, shown in listings and the UI",
  effort:
    'How much model capability the task deserves: "quick" (cheap and fast — lookups, mechanical edits), "standard" (ordinary implementation work; the default), or "deep" (planning, architecture, hard debugging). The router maps this to the best model available here.',
  needs:
    'Hard requirements, only when the task actually has them: "long-context" (must read a very large amount of material), "vision" (must look at images), "thinking" (must have reasoning enabled). Each entry filters the candidate models, so omit what you do not need.',
  workingDir:
    "Trusted working directory for the autonomous child (default: current working directory)",
  model:
    'Escape hatch: an exact "provider/model-id" that bypasses routing entirely. Use only when the user names a specific model; otherwise use `effort`.',
};

/** Builds the subagent_spawn result that tells the parent model how to continue or inspect the child. */
export function buildSubagentSpawnResult(options: {
  id: string;
  title: string;
  effort: string;
  modelLabel: string;
  routeReason: string;
  cwd: string;
}) {
  return (
    `Spawned subagent ${options.id} "${options.title}" (${options.effort} → ${options.modelLabel}` +
    ` via ${options.routeReason}, ${options.cwd}).\n` +
    `It runs in the background. Its result will be delivered to you when it finishes, ` +
    `or use subagent_wait(ids: ["${options.id}"]) to block for it, subagent_cancel to stop it, subagent_check to peek, subagent_list to see all.`
  );
}

/** Describes explicit blocking collection of one or more subagent results. */
export const SUBAGENT_WAIT_TOOL_DESCRIPTION =
  "Block until all listed subagents have settled, then return their final outputs. Prefer letting results arrive automatically; use this only when you need a result before continuing.";

/** Model-facing schema description for the subagent ids to await. */
export const SUBAGENT_WAIT_PARAMETER_DESCRIPTIONS = {
  ids: 'Subagent ids to wait for, e.g. ["sa-1", "sa-2"]',
};

/** Describes aborting running subagents while retaining their partial transcripts. */
export const SUBAGENT_CANCEL_TOOL_DESCRIPTION =
  "Cancel one or more running subagents. This aborts their active work but preserves their partial session transcripts on disk.";

/** Model-facing schema description for the subagent ids to cancel. */
export const SUBAGENT_CANCEL_PARAMETER_DESCRIPTIONS = {
  ids: 'Subagent ids to cancel, e.g. ["sa-1", "sa-2"]',
};

/** Describes nonblocking inspection of a subagent without consuming its result. */
export const SUBAGENT_CHECK_TOOL_DESCRIPTION =
  "Peek at a subagent's status and recent activity without blocking. Does not consume its result.";

/** Model-facing schema description for the subagent id to inspect. */
export const SUBAGENT_CHECK_PARAMETER_DESCRIPTIONS = {
  id: "Subagent id",
};

/** Describes listing all tracked running and settled subagents. */
export const SUBAGENT_LIST_TOOL_DESCRIPTION =
  "List all subagents (running and finished) with their model and status.";

/** Builds the child completion/failure wrapper injected into the parent model's context. */
export function buildSubagentResultMessage(options: {
  id: string;
  title: string;
  status: "running" | "done" | "error";
  errorText?: string;
  output: string;
}) {
  const verb = options.status === "error" ? "failed" : "finished";
  let text = `Subagent ${options.id} "${options.title}" ${verb}.`;
  if (options.errorText) text += `\nError: ${options.errorText}`;
  text += `\n\n${options.output}`;
  return text;
}

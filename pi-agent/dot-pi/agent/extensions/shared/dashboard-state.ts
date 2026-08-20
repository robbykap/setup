export const MODEL_INFO_CHANNEL = "dashboard:model-info";
export const GIT_INFO_CHANNEL = "dashboard:git-info";
export const REFRESH_CHANNEL = "dashboard:refresh";

export interface ModelInfoState {
  provider: string;
  modelId: string;
  modelName: string;
  thinking: string;
  contextTokens: number | null;
  contextWindow: number;
  contextPercent: number | null;
  cost: number;
  tokensPerSecond: number | null;
  generating: boolean;
}

export interface PullRequestInfo {
  number: number;
  url: string;
  isDraft: boolean;
}

export interface GitInfoState {
  isRepository: boolean;
  branch: string | null;
  changedFiles: number;
  pullRequest: PullRequestInfo | null;
}

export function emptyModelInfoState(): ModelInfoState {
  return {
    provider: "",
    modelId: "no-model",
    modelName: "No model",
    thinking: "off",
    contextTokens: null,
    contextWindow: 0,
    contextPercent: null,
    cost: 0,
    tokensPerSecond: null,
    generating: false,
  };
}

export function emptyGitInfoState(): GitInfoState {
  return {
    isRepository: false,
    branch: null,
    changedFiles: 0,
    pullRequest: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown) {
  return value === null || typeof value === "number";
}

export function isModelInfoState(value: unknown): value is ModelInfoState {
  if (!isRecord(value)) return false;

  return (
    typeof value.provider === "string" &&
    typeof value.modelId === "string" &&
    typeof value.modelName === "string" &&
    typeof value.thinking === "string" &&
    isNullableNumber(value.contextTokens) &&
    typeof value.contextWindow === "number" &&
    isNullableNumber(value.contextPercent) &&
    typeof value.cost === "number" &&
    isNullableNumber(value.tokensPerSecond) &&
    typeof value.generating === "boolean"
  );
}

function isPullRequestInfo(value: unknown): value is PullRequestInfo {
  if (!isRecord(value)) return false;

  return (
    typeof value.number === "number" &&
    typeof value.url === "string" &&
    typeof value.isDraft === "boolean"
  );
}

export function isGitInfoState(value: unknown): value is GitInfoState {
  if (!isRecord(value)) return false;

  return (
    typeof value.isRepository === "boolean" &&
    (value.branch === null || typeof value.branch === "string") &&
    typeof value.changedFiles === "number" &&
    (value.pullRequest === null || isPullRequestInfo(value.pullRequest))
  );
}

/** A file changed by a child session (subagent or workflow), announced to the
 * parent so its picker can list it. The child's own patch rides along when its
 * tool produced one, because the parent cannot always reconstruct the diff
 * itself: a commit made mid-session moves HEAD past the work, and a child may
 * be running somewhere git cannot describe at all. */
export const CHILD_FILE_CHANNEL = "dashboard:child-file";

/** A file a child session edited: the path its tool named, plus that tool's
 * own patch when it produced one. What both child runners — subagents and
 * workflows — hand to their parent, and the payload half of the event below. */
export interface ChildFile {
  readonly path: string;
  readonly patch?: string;
}

/**
 * The unified patch an `edit` result carries (`EditToolDetails.patch`).
 * `write` carries none, and a hook — or a tool we have never seen — can put
 * anything at all there, so nothing but a non-empty string is taken.
 * Returned as a spreadable object, so a caller never has to build a
 * `ChildFile` with an explicit `patch: undefined`.
 */
export function patchOf(result: unknown): { patch?: string } {
  const details = (result as { details?: { patch?: unknown } } | undefined)
    ?.details;
  const patch = details?.patch;
  return typeof patch === "string" && patch.length > 0 ? { patch } : {};
}

export interface ChildFileEvent {
  readonly path: string;
  /** The child's unified patch for this edit, when its tool produced one
   * (`edit` does; `write` does not). */
  readonly patch?: string;
  readonly origin:
    | { readonly kind: "subagent"; readonly id: string; readonly name: string }
    | { readonly kind: "workflow"; readonly label: string };
  /** The child's working directory. A relative path must be resolved against
   * this, not the parent's cwd — a child may run somewhere else entirely. */
  readonly cwd?: string;
}

export function isChildFileEvent(value: unknown): value is ChildFileEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ChildFileEvent>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.origin === "object" &&
    candidate.origin !== null &&
    // Absent is valid, and has to stay valid: an emitter a version behind
    // sends no patch at all, and its file still belongs in the picker.
    (candidate.patch === undefined || typeof candidate.patch === "string")
  );
}

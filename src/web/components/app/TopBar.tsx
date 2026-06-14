import { useEffect, useState } from "react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  GitBranchIcon,
  GitMergeIcon,
  MoonIcon,
  PlusIcon,
  RefreshCwIcon,
  SunIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { getApiErrorMessage } from "@/web/api/errors";
import type {
  ApiErrorResponse,
  RepositoryBranchCreateRequest,
  RepositoryBranchDeleteRequest,
  RepositoryBranchMergeRequest,
  RepositoryBranchesResponse,
  RepositoryBranchSwitchRequest,
} from "@/web/api/responses";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/web/components/ui/alert";
import { Button } from "@/web/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
} from "@/web/components/ui/combobox";
import { Input } from "@/web/components/ui/input";
import StatusIndicator from "@/web/components/ui/status-indicator";
import {
  connectionStatusConfig,
  type RuntimeStreamState,
} from "@/web/events/runtimeStream";
import { getSseConnectionIndicatorState } from "./topBarConnection";
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import { getRepositoryFolderLabel } from "@/web/repository/repositoryPath";
import {
  getBranchMergeSuccessDescription,
  getWorkingTreeStatusLabel,
  shouldShowBranchSelector,
} from "./topBarGit";
import {
  isActiveRunnerStatus,
  type RunnerStatus,
} from "@/web/runner/statuses";
import {
  getInitialThemeMode,
  getNextThemeMode,
  getThemeToggleLabel,
  persistThemeMode,
  type ThemeMode,
} from "./topBarTheme";

type BranchLoadStatus = "idle" | "loading" | "ready";
type BranchOperation = "idle" | "switching" | "creating" | "merging" | "deleting";
type BranchMergeAlert = {
  description: string;
  title: string;
  variant: "success" | "error";
};
type SseConnectionStatus = RuntimeStreamState["connectionStatus"];

const EMPTY_BRANCHES: RepositoryBranchesResponse = {
  currentBranch: null,
  branches: [],
  workingTreeStatus: "unknown",
};

export function TopBar({
  actionSlotId,
  connectionStatus,
  repositorySelection,
  status,
}: {
  actionSlotId: string;
  connectionStatus: SseConnectionStatus;
  repositorySelection: RepositorySelectionState;
  status: RunnerStatus;
}) {
  const selectedRepositoryLabel = getRepositoryFolderLabel(repositorySelection);
  const showBranchSelector = shouldShowBranchSelector(repositorySelection);
  const selectedRepositoryPath =
    repositorySelection.status === "ready"
      ? repositorySelection.repositoryPath
      : null;
  const [branchLoadStatus, setBranchLoadStatus] =
    useState<BranchLoadStatus>("idle");
  const [branchOperation, setBranchOperation] =
    useState<BranchOperation>("idle");
  const [branchState, setBranchState] =
    useState<RepositoryBranchesResponse>(EMPTY_BRANCHES);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [branchMergeAlert, setBranchMergeAlert] =
    useState<BranchMergeAlert | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [theme, setTheme] = useState<ThemeMode>(getInitialThemeMode);
  const isRunActive = isActiveRunnerStatus(status);

  useEffect(() => {
    persistThemeMode(theme);
  }, [theme]);

  useEffect(() => {
    if (!selectedRepositoryPath) {
      setBranchLoadStatus("idle");
      setBranchOperation("idle");
      setBranchState(EMPTY_BRANCHES);
      setBranchError(null);
      setBranchMergeAlert(null);
      setNewBranchName("");
      return;
    }

    const abortController = new AbortController();

    async function loadBranches() {
      setBranchLoadStatus("loading");
      setBranchError(null);
      setBranchMergeAlert(null);

      try {
        const branches = await fetchRepositoryBranches(abortController.signal);

        setBranchState(branches);
        setBranchLoadStatus("ready");
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        setBranchState(EMPTY_BRANCHES);
        setBranchLoadStatus("ready");
        setBranchError(
          error instanceof Error
            ? error.message
            : "Failed to load repository branches.",
        );
      }
    }

    void loadBranches();

    return () => {
      abortController.abort();
    };
  }, [selectedRepositoryPath]);

  async function handleBranchSwitch(branch: string | null): Promise<void> {
    if (
      !branch ||
      branch === branchState.currentBranch ||
      branchOperation !== "idle" ||
      isRunActive
    ) {
      return;
    }

    setBranchOperation("switching");
    setBranchError(null);
    setBranchMergeAlert(null);

    try {
      const branches = await postBranchRequest<RepositoryBranchSwitchRequest>(
        "/api/repository/branches/switch",
        { branch },
        "Failed to switch branches.",
      );

      setBranchState(branches);
    } catch (error) {
      setBranchError(
        error instanceof Error ? error.message : "Failed to switch branches.",
      );
    } finally {
      setBranchOperation("idle");
    }
  }

  async function handleBranchCreate(): Promise<void> {
    const trimmedBranchName = newBranchName.trim();

    if (!trimmedBranchName || branchOperation !== "idle" || isRunActive) {
      return;
    }

    setBranchOperation("creating");
    setBranchError(null);
    setBranchMergeAlert(null);

    try {
      const branches = await postBranchRequest<RepositoryBranchCreateRequest>(
        "/api/repository/branches",
        { name: trimmedBranchName },
        "Failed to create branch.",
      );

      setBranchState(branches);
      setNewBranchName("");
    } catch (error) {
      setBranchError(
        error instanceof Error ? error.message : "Failed to create branch.",
      );
    } finally {
      setBranchOperation("idle");
    }
  }

  async function handleBranchRefresh(): Promise<void> {
    if (branchOperation !== "idle") {
      return;
    }

    setBranchLoadStatus("loading");
    setBranchError(null);
    setBranchMergeAlert(null);

    try {
      const branches = await fetchRepositoryBranches();

      setBranchState(branches);
    } catch (error) {
      setBranchError(
        error instanceof Error
          ? error.message
          : "Failed to load repository branches.",
      );
    } finally {
      setBranchLoadStatus("ready");
    }
  }

  async function handleBranchMerge(branch: string): Promise<void> {
    if (
      branch === branchState.currentBranch ||
      branchOperation !== "idle" ||
      isRunActive
    ) {
      return;
    }

    setBranchOperation("merging");
    setBranchError(null);
    setBranchMergeAlert(null);

    try {
      const branches = await postBranchRequest<RepositoryBranchMergeRequest>(
        "/api/repository/branches/merge",
        { branch },
        "Failed to merge branch.",
      );

      setBranchState(branches);
      setBranchMergeAlert({
        description: getBranchMergeSuccessDescription(
          branch,
          branches.currentBranch,
        ),
        title: "Merge successful",
        variant: "success",
      });
    } catch (error) {
      setBranchMergeAlert({
        description:
          error instanceof Error ? error.message : "Failed to merge branch.",
        title: "Merge failed",
        variant: "error",
      });
    } finally {
      setBranchOperation("idle");
    }
  }

  async function handleBranchDelete(branch: string): Promise<void> {
    if (
      branch === branchState.currentBranch ||
      branchOperation !== "idle" ||
      isRunActive
    ) {
      return;
    }

    const confirmed = window.confirm(`Delete local branch "${branch}"?`);

    if (!confirmed) {
      return;
    }

    setBranchOperation("deleting");
    setBranchError(null);
    setBranchMergeAlert(null);

    try {
      const branches = await deleteBranchRequest<RepositoryBranchDeleteRequest>(
        "/api/repository/branches",
        { branch },
        "Failed to delete branch.",
      );

      setBranchState(branches);
    } catch (error) {
      setBranchError(
        error instanceof Error ? error.message : "Failed to delete branch.",
      );
    } finally {
      setBranchOperation("idle");
    }
  }

  return (
    <header className="top-bar sticky top-0 z-30 flex shrink-0 border-b border-border bg-background/95 shadow-sm shadow-black/[0.03] backdrop-blur dark:bg-background/90 dark:shadow-black/30">
      <div className="top-bar__layout grid min-w-0 flex-1 items-center gap-x-4 gap-y-2 px-4">
        <div className="top-bar__brand-group min-w-0 justify-self-start">
          <h1 className="top-bar__title truncate text-base font-semibold leading-6 text-foreground">
            Agent Goal Runner
          </h1>
          <div className="top-bar__brand-controls min-w-0">
            <SseConnectionBadge connectionStatus={connectionStatus} />
            <ThemeToggleButton
              onToggle={() => {
                setTheme((currentTheme) => getNextThemeMode(currentTheme));
              }}
              theme={theme}
            />
          </div>
        </div>

        <div className="top-bar__repo-group min-w-0 justify-self-center">
          <span
            className="top-bar__repo-label max-w-[18rem] truncate text-base font-semibold leading-6 text-foreground"
            title={selectedRepositoryLabel}
          >
            {selectedRepositoryLabel}
          </span>
          {showBranchSelector ? (
            <BranchSelector
              branchError={branchError}
              branchLoadStatus={branchLoadStatus}
              branchMergeAlert={branchMergeAlert}
              branchOperation={branchOperation}
              branchState={branchState}
              disabled={isRunActive}
              newBranchName={newBranchName}
              onBranchCreate={handleBranchCreate}
              onBranchDelete={handleBranchDelete}
              onBranchMerge={handleBranchMerge}
              onBranchMergeAlertDismiss={() => {
                setBranchMergeAlert(null);
              }}
              onBranchNameChange={setNewBranchName}
              onBranchRefresh={handleBranchRefresh}
              onBranchSwitch={handleBranchSwitch}
            />
          ) : null}
        </div>

        <div
          className="top-bar__actions flex min-w-0 shrink-0 items-center justify-end gap-2 justify-self-end"
          id={actionSlotId}
        />
      </div>
    </header>
  );
}

function SseConnectionBadge({
  connectionStatus,
}: {
  connectionStatus: SseConnectionStatus;
}) {
  const config = connectionStatusConfig[connectionStatus];

  return (
    <div
      aria-label={`SSE connection: ${config.label}`}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2 text-xs font-medium text-muted-foreground"
      role="status"
      title={config.label}
    >
      <StatusIndicator
        className="gap-0"
        size="sm"
        state={getSseConnectionIndicatorState(connectionStatus)}
      />
      <span className="whitespace-nowrap">SSE connection</span>
    </div>
  );
}

function ThemeToggleButton({
  onToggle,
  theme,
}: {
  onToggle: () => void;
  theme: ThemeMode;
}) {
  const Icon = theme === "dark" ? SunIcon : MoonIcon;
  const label = getThemeToggleLabel(theme);

  return (
    <Button
      aria-label={label}
      aria-pressed={theme === "dark"}
      className="size-7 border-border bg-background/80 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground dark:bg-muted/60 dark:hover:bg-accent"
      onClick={onToggle}
      size="icon"
      title={label}
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className="size-4"
      />
    </Button>
  );
}

function BranchSelector({
  branchError,
  branchLoadStatus,
  branchMergeAlert,
  branchOperation,
  branchState,
  disabled,
  newBranchName,
  onBranchCreate,
  onBranchDelete,
  onBranchMerge,
  onBranchMergeAlertDismiss,
  onBranchNameChange,
  onBranchRefresh,
  onBranchSwitch,
}: {
  branchError: string | null;
  branchLoadStatus: BranchLoadStatus;
  branchMergeAlert: BranchMergeAlert | null;
  branchOperation: BranchOperation;
  branchState: RepositoryBranchesResponse;
  disabled: boolean;
  newBranchName: string;
  onBranchCreate: () => Promise<void>;
  onBranchDelete: (branch: string) => Promise<void>;
  onBranchMerge: (branch: string) => Promise<void>;
  onBranchMergeAlertDismiss: () => void;
  onBranchNameChange: (branchName: string) => void;
  onBranchRefresh: () => Promise<void>;
  onBranchSwitch: (branch: string | null) => Promise<void>;
}) {
  const isBusy = branchLoadStatus === "loading" || branchOperation !== "idle";
  const isDisabled = disabled || isBusy;
  const selectedBranch = branchState.currentBranch ?? "";
  const selectedBranchLabel =
    branchLoadStatus === "loading"
      ? "Loading..."
      : (branchState.currentBranch ?? "Detached HEAD");
  const workingTreeLabel = getWorkingTreeStatusLabel(
    branchState.workingTreeStatus,
  );

  return (
    <div className="top-bar__branch-selector relative flex min-w-0 flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <Combobox<string>
          items={branchState.branches}
          onValueChange={(value) => {
            void onBranchSwitch(value);
          }}
          value={selectedBranch}
        >
          <ComboboxInput
            aria-label="Git branch"
            className="w-48"
            disabled={isDisabled}
            readOnly
            value={selectedBranchLabel}
          >
            <GitBranchIcon className="pointer-events-none ml-2 size-4 text-muted-foreground" />
          </ComboboxInput>
          <ComboboxContent className="w-72">
            <ComboboxList>
              {branchState.branches.map((branch) => (
                <BranchItem
                  branch={branch}
                  currentBranch={branchState.currentBranch}
                  disabled={isDisabled}
                  key={branch}
                  onBranchDelete={onBranchDelete}
                  onBranchMerge={onBranchMerge}
                />
              ))}
            </ComboboxList>
            <ComboboxSeparator />
            <form
              className="flex gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void onBranchCreate();
              }}
            >
              <Input
                aria-label="New branch name"
                className="h-8 min-w-0 text-sm"
                disabled={isDisabled}
                onChange={(event) => {
                  onBranchNameChange(event.target.value);
                }}
                placeholder="new-branch"
                value={newBranchName}
              />
              <Button
                disabled={isDisabled || newBranchName.trim().length === 0}
                size="sm"
                type="submit"
                variant="outline"
              >
                <PlusIcon className="size-4" />
                Add
              </Button>
            </form>
          </ComboboxContent>
        </Combobox>
        <Button
          aria-label="Refresh Git branches"
          className="size-8"
          disabled={isDisabled}
          onClick={() => {
            void onBranchRefresh();
          }}
          size="icon"
          title="Refresh Git branches"
          type="button"
          variant="outline"
        >
          <RefreshCwIcon className="size-4" />
        </Button>
        <span
          className="whitespace-nowrap text-xs font-medium text-muted-foreground"
          title={`Working tree: ${workingTreeLabel}`}
        >
          {workingTreeLabel}
        </span>
      </div>
      {branchError ? (
        <p
          className="max-w-64 truncate text-xs font-medium text-destructive"
          title={branchError}
        >
          {branchError}
        </p>
      ) : null}
      {branchMergeAlert ? (
        <BranchMergeFeedbackAlert
          alert={branchMergeAlert}
          onDismiss={onBranchMergeAlertDismiss}
        />
      ) : null}
    </div>
  );
}

function BranchMergeFeedbackAlert({
  alert,
  onDismiss,
}: {
  alert: BranchMergeAlert;
  onDismiss: () => void;
}) {
  const Icon = alert.variant === "success" ? CheckCircle2Icon : AlertCircleIcon;

  return (
    <Alert
      className="absolute left-1/2 top-full z-40 mt-2 w-96 max-w-[calc(100vw-2rem)] -translate-x-1/2 pr-12 shadow-lg"
      variant={alert.variant === "error" ? "destructive" : "default"}
    >
      <Button
        aria-label="Dismiss merge alert"
        className="absolute right-2 top-2 size-7"
        onClick={onDismiss}
        size="icon"
        title="Dismiss merge alert"
        type="button"
        variant="ghost"
      >
        <XIcon data-icon="inline-start" />
      </Button>
      <Icon />
      <div>
        <AlertTitle>{alert.title}</AlertTitle>
        <AlertDescription>{alert.description}</AlertDescription>
      </div>
    </Alert>
  );
}

function BranchItem({
  branch,
  currentBranch,
  disabled,
  onBranchDelete,
  onBranchMerge,
}: {
  branch: string;
  currentBranch: string | null;
  disabled: boolean;
  onBranchDelete: (branch: string) => Promise<void>;
  onBranchMerge: (branch: string) => Promise<void>;
}) {
  const isCurrentBranch = branch === currentBranch;

  return (
    <ComboboxItem
      className={isCurrentBranch ? undefined : "pr-20"}
      value={branch}
    >
      <span className="min-w-0 flex-1 truncate">{branch}</span>
      {isCurrentBranch ? null : (
        <span className="absolute right-1 flex items-center gap-1">
          <Button
            aria-label={`Merge ${branch} into current branch`}
            className="size-7"
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onBranchMerge(branch);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            size="icon"
            title={`Merge ${branch} into current branch`}
            type="button"
            variant="ghost"
          >
            <GitMergeIcon className="size-4" />
          </Button>
          <Button
            aria-label={`Delete ${branch}`}
            className="size-7 text-destructive hover:text-destructive"
            disabled={disabled}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onBranchDelete(branch);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            size="icon"
            title={`Delete ${branch}`}
            type="button"
            variant="ghost"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </span>
      )}
    </ComboboxItem>
  );
}

async function fetchRepositoryBranches(
  signal?: AbortSignal,
): Promise<RepositoryBranchesResponse> {
  const response = await fetch("/api/repository/branches", {
    signal,
  });

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(
        (await response.json().catch(() => ({}))) as ApiErrorResponse,
        "Failed to load repository branches.",
      ),
    );
  }

  return (await response.json()) as RepositoryBranchesResponse;
}

async function deleteBranchRequest<TBody>(
  url: string,
  body: TBody,
  fallbackError: string,
): Promise<RepositoryBranchesResponse> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(
        (await response.json().catch(() => ({}))) as ApiErrorResponse,
        fallbackError,
      ),
    );
  }

  return (await response.json()) as RepositoryBranchesResponse;
}

async function postBranchRequest<TBody>(
  url: string,
  body: TBody,
  fallbackError: string,
): Promise<RepositoryBranchesResponse> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      getApiErrorMessage(
        (await response.json().catch(() => ({}))) as ApiErrorResponse,
        fallbackError,
      ),
    );
  }

  return (await response.json()) as RepositoryBranchesResponse;
}

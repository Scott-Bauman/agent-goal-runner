import { useEffect, useState } from "react";
import { GitBranchIcon, PlusIcon } from "lucide-react";

import { getApiErrorMessage } from "@/web/api/errors";
import type {
  ApiErrorResponse,
  RepositoryBranchCreateRequest,
  RepositoryBranchesResponse,
  RepositoryBranchSwitchRequest,
} from "@/web/api/responses";
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
import type { RepositorySelectionState } from "@/web/repository/repositorySelection";
import { getRepositoryFolderLabel } from "@/web/repository/repositoryPath";
import {
  isActiveRunnerStatus,
  type RunnerStatus,
} from "@/web/runner/statuses";

type BranchLoadStatus = "idle" | "loading" | "ready";
type BranchOperation = "idle" | "switching" | "creating";

const EMPTY_BRANCHES: RepositoryBranchesResponse = {
  currentBranch: null,
  branches: [],
};

export function TopBar({
  actionSlotId,
  repositorySelection,
  status,
}: {
  actionSlotId: string;
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
  const [newBranchName, setNewBranchName] = useState("");
  const isRunActive = isActiveRunnerStatus(status);

  useEffect(() => {
    if (!selectedRepositoryPath) {
      setBranchLoadStatus("idle");
      setBranchOperation("idle");
      setBranchState(EMPTY_BRANCHES);
      setBranchError(null);
      setNewBranchName("");
      return;
    }

    const abortController = new AbortController();

    async function loadBranches() {
      setBranchLoadStatus("loading");
      setBranchError(null);

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

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center border-b border-zinc-200 bg-white">
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4">
        <div className="min-w-0 justify-self-start">
          <h1 className="truncate text-base font-semibold leading-6 text-zinc-950">
            Agent Goal Runner
          </h1>
        </div>

        <div className="flex min-w-0 items-center justify-center gap-3 justify-self-center">
          <span
            className="max-w-[18rem] truncate text-base font-semibold leading-6 text-zinc-950"
            title={selectedRepositoryLabel}
          >
            {selectedRepositoryLabel}
          </span>
          {showBranchSelector ? (
            <BranchSelector
              branchError={branchError}
              branchLoadStatus={branchLoadStatus}
              branchOperation={branchOperation}
              branchState={branchState}
              disabled={isRunActive}
              newBranchName={newBranchName}
              onBranchCreate={handleBranchCreate}
              onBranchNameChange={setNewBranchName}
              onBranchSwitch={handleBranchSwitch}
            />
          ) : null}
        </div>

        <div
          className="flex min-w-0 shrink-0 items-center justify-end gap-2 justify-self-end"
          id={actionSlotId}
        />
      </div>
    </header>
  );
}

export function shouldShowBranchSelector(
  repositorySelection: RepositorySelectionState,
): boolean {
  return (
    repositorySelection.status === "ready" &&
    repositorySelection.repositoryPath !== null
  );
}

function BranchSelector({
  branchError,
  branchLoadStatus,
  branchOperation,
  branchState,
  disabled,
  newBranchName,
  onBranchCreate,
  onBranchNameChange,
  onBranchSwitch,
}: {
  branchError: string | null;
  branchLoadStatus: BranchLoadStatus;
  branchOperation: BranchOperation;
  branchState: RepositoryBranchesResponse;
  disabled: boolean;
  newBranchName: string;
  onBranchCreate: () => Promise<void>;
  onBranchNameChange: (branchName: string) => void;
  onBranchSwitch: (branch: string | null) => Promise<void>;
}) {
  const isBusy = branchLoadStatus === "loading" || branchOperation !== "idle";
  const isDisabled = disabled || isBusy;
  const selectedBranch = branchState.currentBranch ?? "";
  const selectedBranchLabel =
    branchLoadStatus === "loading"
      ? "Loading..."
      : (branchState.currentBranch ?? "Detached HEAD");

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
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
          <GitBranchIcon className="pointer-events-none ml-2 size-4 text-zinc-500" />
        </ComboboxInput>
        <ComboboxContent className="w-64">
          <ComboboxList>
            {branchState.branches.map((branch) => (
              <ComboboxItem
                key={branch}
                value={branch}
              >
                {branch}
              </ComboboxItem>
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
      {branchError ? (
        <p
          className="max-w-64 truncate text-xs font-medium text-red-600"
          title={branchError}
        >
          {branchError}
        </p>
      ) : null}
    </div>
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

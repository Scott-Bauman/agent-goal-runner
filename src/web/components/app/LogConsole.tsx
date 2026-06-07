import { useEffect, useMemo, useRef, useState } from "react";

import type { LogEntry } from "@/web/events/runtimeStream";
import { cn } from "@/web/lib/utils";
import {
  classifyLogMessage,
  type LogActivityKind,
} from "@/web/components/app/logClassification";

type ClassifiedLog = {
  className: string;
  entry: LogEntry;
  elapsedLabel: string;
  kind: LogActivityKind;
  prefix: string;
};

const BUFFER_FLUSH_MS = 100;
const AUTO_SCROLL_THRESHOLD_PX = 72;

const activityStyle: Record<
  LogActivityKind,
  {
    className: string;
    prefix: string;
  }
> = {
  activity: {
    className: "text-zinc-200",
    prefix: "›",
  },
  command: {
    className: "text-sky-300",
    prefix: "$",
  },
  error: {
    className: "text-red-300",
    prefix: "×",
  },
  git: {
    className: "text-cyan-300",
    prefix: "git",
  },
  success: {
    className: "text-emerald-300",
    prefix: "✓",
  },
  summary: {
    className: "text-violet-300",
    prefix: "◆",
  },
  warning: {
    className: "text-amber-300",
    prefix: "!",
  },
};

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) {
    return "+0.0s";
  }

  return `+${(milliseconds / 1000).toFixed(1)}s`;
}

function useBufferedLogEntries(logs: LogEntry[]): LogEntry[] {
  const [visibleLogs, setVisibleLogs] = useState<LogEntry[]>(logs);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setVisibleLogs(logs);
    }, BUFFER_FLUSH_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [logs]);

  return visibleLogs;
}

function useRunStartTime(logs: LogEntry[]): number {
  const [runStartTime, setRunStartTime] = useState(() => Date.now());
  const firstLogId = logs[0]?.id ?? null;

  useEffect(() => {
    if (firstLogId === null) {
      setRunStartTime(Date.now());
      return;
    }

    setRunStartTime(Date.now());
  }, [firstLogId]);

  return runStartTime;
}

function isNearBottom(element: HTMLDivElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_THRESHOLD_PX
  );
}

function LogLine({ log }: { log: ClassifiedLog }) {
  return (
    <li className="grid min-w-0 grid-cols-[3.25rem_2rem_minmax(0,1fr)] gap-2 font-mono text-xs leading-5">
      <time className="select-none text-right text-[0.6875rem] text-zinc-600">
        {log.elapsedLabel}
      </time>
      <span
        className={cn(
          "select-none text-right text-[0.6875rem] font-semibold",
          log.className,
        )}
      >
        {log.prefix}
      </span>
      <span className={cn("min-w-0 whitespace-pre-wrap break-words", log.className)}>
        {log.entry.message}
      </span>
    </li>
  );
}

function LogConsoleIdleState() {
  return (
    <div className="relative min-h-full font-mono text-xs leading-5">
      <p className="text-zinc-200">
        <span className="mr-2 text-zinc-500">›</span>
        waiting for agent run
      </p>
      <p className="absolute left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 text-center text-zinc-500">
        Agent activity, command output, verification, file changes, and
        completion status will appear here.
      </p>
    </div>
  );
}

export function LogConsole({
  logs,
}: {
  logs: LogEntry[];
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const visibleLogs = useBufferedLogEntries(logs);
  const runStartTime = useRunStartTime(visibleLogs);

  const classifiedLogs = useMemo<ClassifiedLog[]>(
    () =>
      visibleLogs.map((entry, index) => {
        const kind = classifyLogMessage(entry.message);
        const style = activityStyle[kind];

        return {
          className: style.className,
          elapsedLabel: formatElapsed(Date.now() - runStartTime + index * 32),
          entry,
          kind,
          prefix: style.prefix,
        };
      }),
    [runStartTime, visibleLogs],
  );

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer || !shouldAutoScrollRef.current) {
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [classifiedLogs.length]);

  function handleScroll(): void {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    shouldAutoScrollRef.current = isNearBottom(scrollContainer);
  }

  return (
    <div
      aria-live="polite"
      className="min-h-0 flex-1 overflow-auto bg-zinc-950 px-4 py-3"
      onScroll={handleScroll}
      ref={scrollContainerRef}
    >
      {classifiedLogs.length > 0 ? (
        <ol className="grid content-start gap-1.5">
          {classifiedLogs.map((log) => (
            <LogLine key={log.entry.id} log={log} />
          ))}
        </ol>
      ) : (
        <LogConsoleIdleState />
      )}
    </div>
  );
}

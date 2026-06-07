import { ArrowDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  RuntimeTranscriptEntry,
  RuntimeTranscriptLogEntry,
  TranscriptEventKind,
} from "@/web/events/runtimeStream";
import { cn } from "@/web/lib/utils";
import {
  parseFencedMessage,
  splitTextByPaths,
  type MessageSegment,
} from "@/web/components/app/logText";

type DisplayLog = {
  className: string;
  elapsedLabel: string;
  entry: RuntimeTranscriptEntry;
  label: string;
  segments: MessageSegment[];
};

const BUFFER_FLUSH_MS = 100;
const AUTO_SCROLL_THRESHOLD_PX = 96;

const eventStyle: Record<
  TranscriptEventKind,
  {
    className: string;
    label: string;
  }
> = {
  agent: {
    className: "border-zinc-800 text-zinc-200",
    label: "[agent]",
  },
  command: {
    className: "border-sky-900/70 text-sky-200",
    label: "[command]",
  },
  done: {
    className: "border-emerald-900/70 text-emerald-200",
    label: "[done]",
  },
  edit: {
    className: "border-fuchsia-900/70 text-fuchsia-200",
    label: "[edit]",
  },
  error: {
    className: "border-red-900/70 text-red-200",
    label: "[error]",
  },
  git: {
    className: "border-cyan-900/70 text-cyan-200",
    label: "[git]",
  },
  verify: {
    className: "border-amber-900/70 text-amber-200",
    label: "[verify]",
  },
  warn: {
    className: "border-orange-900/70 text-orange-200",
    label: "[warn]",
  },
};

function formatElapsed(milliseconds: number): string {
  if (milliseconds < 1000) {
    return "+0.0s";
  }

  return `+${(milliseconds / 1000).toFixed(1)}s`;
}

function useBufferedTranscript(
  logs: RuntimeTranscriptEntry[],
): RuntimeTranscriptEntry[] {
  const [visibleLogs, setVisibleLogs] =
    useState<RuntimeTranscriptEntry[]>(logs);

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

function isNearBottom(element: HTMLDivElement): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_THRESHOLD_PX
  );
}

function LogText({ text }: { text: string }) {
  return (
    <>
      {splitTextByPaths(text).map((part, index) =>
        part.type === "path" ? (
          <span
            className="font-semibold text-zinc-50 underline decoration-zinc-600 underline-offset-2"
            key={`${part.fullPath}-${index}`}
            title={part.fullPath}
          >
            {part.text}
          </span>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

function CodeBlock({
  language,
  text,
}: {
  language: string | null;
  text: string;
}) {
  return (
    <div className="my-2 overflow-hidden rounded-md border border-zinc-800 bg-zinc-900/80">
      {language ? (
        <div className="border-b border-zinc-800 px-3 py-1 text-[0.625rem] uppercase text-zinc-500">
          {language}
        </div>
      ) : null}
      <pre className="overflow-x-auto px-3 py-2 text-[0.75rem] leading-5 text-zinc-100">
        <code>{text}</code>
      </pre>
    </div>
  );
}

function LogBody({ segments }: { segments: MessageSegment[] }) {
  return (
    <div className="min-w-0 whitespace-pre-wrap break-words">
      {segments.map((segment, index) =>
        segment.type === "code" ? (
          <CodeBlock
            key={`code-${index}`}
            language={segment.language}
            text={segment.text}
          />
        ) : (
          <LogText key={`text-${index}`} text={segment.text} />
        ),
      )}
    </div>
  );
}

function LogHeader({ entry, log }: { entry: RuntimeTranscriptEntry; log: DisplayLog }) {
  const sourceLabel =
    entry.type === "log" ? (entry as RuntimeTranscriptLogEntry).stream : entry.displayId;

  return (
    <div className="flex min-w-0 items-center gap-2 text-[0.6875rem] leading-4">
      <time className="shrink-0 select-none text-zinc-600">
        {log.elapsedLabel}
      </time>
      <span className={cn("shrink-0 select-none font-semibold", log.className)}>
        {log.label}
      </span>
      <span className="min-w-0 truncate text-zinc-600">{sourceLabel}</span>
    </div>
  );
}

function LogBlock({ log }: { log: DisplayLog }) {
  const isSeparator = log.entry.type === "separator";

  if (isSeparator) {
    return (
      <li className="grid gap-2 py-1">
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-zinc-800" />
          <div
            className={cn(
              "max-w-[80%] truncate rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-[0.6875rem] font-semibold",
              log.className,
            )}
            title={log.entry.message}
          >
            {log.label} {log.entry.message}
          </div>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "grid gap-2 border-l-2 bg-zinc-900/35 px-3 py-2 font-mono text-xs leading-5",
        log.className,
      )}
    >
      <LogHeader entry={log.entry} log={log} />
      <LogBody segments={log.segments} />
    </li>
  );
}

function LogConsoleIdleState() {
  return (
    <div className="relative min-h-full font-mono text-xs leading-5">
      <p className="text-zinc-200">
        <span className="mr-2 text-zinc-500">[agent]</span>
        waiting for agent run
      </p>
      <p className="absolute left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 text-center text-zinc-500">
        Agent activity, command output, verification, file changes, and
        completion status will appear here.
      </p>
    </div>
  );
}

export function LogConsole({ logs }: { logs: RuntimeTranscriptEntry[] }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const visibleLogs = useBufferedTranscript(logs);
  const firstReceivedAt = visibleLogs[0]?.receivedAt ?? Date.now();

  const displayLogs = useMemo<DisplayLog[]>(
    () =>
      visibleLogs.map((entry) => {
        const style = eventStyle[entry.kind];

        return {
          className: style.className,
          elapsedLabel: formatElapsed(entry.receivedAt - firstReceivedAt),
          entry,
          label: style.label,
          segments: parseFencedMessage(entry.message),
        };
      }),
    [firstReceivedAt, visibleLogs],
  );

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer || !shouldAutoScrollRef.current) {
      return;
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [displayLogs.length]);

  function handleScroll(): void {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    const nextIsFollowingLatest = isNearBottom(scrollContainer);
    shouldAutoScrollRef.current = nextIsFollowingLatest;
    setIsFollowingLatest(nextIsFollowingLatest);
  }

  function jumpToLatest(): void {
    const scrollContainer = scrollContainerRef.current;

    if (!scrollContainer) {
      return;
    }

    shouldAutoScrollRef.current = true;
    setIsFollowingLatest(true);
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }

  return (
    <div className="relative min-h-0 flex-1 bg-zinc-950">
      <div
        aria-live="polite"
        className="h-full min-h-0 overflow-auto px-4 py-3"
        onScroll={handleScroll}
        ref={scrollContainerRef}
      >
        {displayLogs.length > 0 ? (
          <ol className="grid content-start gap-2">
            {displayLogs.map((log) => (
              <LogBlock key={log.entry.id} log={log} />
            ))}
          </ol>
        ) : (
          <LogConsoleIdleState />
        )}
      </div>
      {displayLogs.length > 0 && !isFollowingLatest ? (
        <button
          className="absolute bottom-3 right-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-3 font-mono text-[0.6875rem] font-semibold text-zinc-100 shadow-lg shadow-zinc-950/40 hover:bg-zinc-800"
          onClick={jumpToLatest}
          type="button"
        >
          <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}

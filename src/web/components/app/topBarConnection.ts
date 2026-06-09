import type { RuntimeStreamState } from "@/web/events/runtimeStream";

type SseConnectionStatus = RuntimeStreamState["connectionStatus"];
type SseConnectionIndicatorState = "active" | "down" | "fixing";

export function getSseConnectionIndicatorState(
  connectionStatus: SseConnectionStatus,
): SseConnectionIndicatorState {
  switch (connectionStatus) {
    case "open":
      return "active";
    case "error":
      return "down";
    case "connecting":
      return "fixing";
  }
}

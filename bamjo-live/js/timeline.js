import { playbackDelayMs, state } from "./state.js";

export function scheduleAtMatchTime(timeMs, callback) {
  const delay = Math.max(0, matchWallTime(timeMs) - Date.now());
  const timer = setTimeout(() => {
    state.pendingTimers.delete(timer);
    callback();
  }, delay);

  state.pendingTimers.add(timer);
  return timer;
}

export function matchWallTime(timeMs) {
  const startedAtMs = Date.parse(state.info?.startedAt || "");
  if (!Number.isFinite(startedAtMs)) {
    return Date.now();
  }

  return startedAtMs + Math.max(0, Number(timeMs || 0)) + playbackDelayMs;
}

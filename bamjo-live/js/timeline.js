import { playbackDelayMs, state } from "./state.js?v=0.5.11";

export function getPlaybackTimeMs() {
  const startedAtMs = Date.parse(state.info?.startedAt || "");
  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }

  const wallTargetMs = Math.max(0, Date.now() - startedAtMs - playbackDelayMs);
  const bufferedLimitMs = getBufferedLimitMs();
  const targetMs = Math.min(wallTargetMs, bufferedLimitMs);
  const now = performance.now();

  if (!state.playbackInitialized) {
    state.playbackInitialized = true;
    state.playbackLastNow = now;
    state.playbackTimeMs = targetMs;
    return state.playbackTimeMs;
  }

  const deltaMs = Math.max(0, now - state.playbackLastNow);
  state.playbackLastNow = now;

  if (state.playbackTimeMs > targetMs + 120) {
    state.playbackTimeMs = targetMs;
  } else {
    state.playbackTimeMs = Math.min(targetMs, state.playbackTimeMs + deltaMs);
  }

  return Math.max(0, state.playbackTimeMs);
}

export function scheduleAtMatchTime(timeMs, callback) {
  const dueAt = matchWallTime(timeMs);
  const delay = Math.max(0, dueAt - Date.now());
  const timer = setTimeout(() => {
    state.pendingTimers.delete(timer);
    callback(dueAt);
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

function getBufferedLimitMs() {
  const frames = state.visualFrames.length > 0
    ? state.visualFrames
    : state.timelineFrames;
  if (frames.length === 0) {
    return Math.max(0, Date.now() - Date.parse(state.info?.startedAt || "") - playbackDelayMs);
  }

  const lastFrameTime = Math.max(...frames.map(frameTime));
  const holdBackMs = state.serverFinished
    ? 0
    : Math.max(180, Number(state.info?.timeline?.visualFrameIntervalMs || 100) * 2);
  return Math.max(0, lastFrameTime - holdBackMs);
}

function frameTime(frame) {
  const time = Number(frame.timeMs);
  if (Number.isFinite(time)) {
    return time;
  }

  const tickDurationMs = Number(state.info?.tickDurationMs || state.animationDurationMs || 2800);
  return Number(frame.tick || 0) * tickDurationMs;
}

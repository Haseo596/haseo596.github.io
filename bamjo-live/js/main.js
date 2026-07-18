import { els, field, reconnectDelayMs, state } from "./state.js?v=0.5.12";
import {
  buildSnapshotUrl,
  buildWebSocketUrl,
  deriveDefaultWebSocketBase,
  normalizeWebSocketBase,
  readWebSocketSource,
  replaceCurrentQuery
} from "./network.js?v=0.5.12";
import { normalizeFrame } from "./frames.js?v=0.5.12";
import { pushEvent, queueFrameEvents, queueTimelineEvents } from "./events.js?v=0.5.12";
import { queueBallPhysicsEvents, resetBallPhysicsFromFrame } from "./ballPhysics.js?v=0.5.12";
import { getPlaybackTimeMs } from "./timeline.js?v=0.5.12";
import {
  getInterpolatedFrame,
  getStatusCode,
  getTickAnimationDuration,
  renderFrame,
  setCustomFieldImage,
  setPhase,
  setStatus,
  updateRosters,
  updateScore,
  updateServerTime,
  updateTick
} from "./render.js?v=0.5.12";

const initialAvailabilityRetries = 10;
const availabilityRetryDelayMs = 750;

init();
requestAnimationFrame(render);

function init() {
  applyFieldGeometry(field);

  const params = new URLSearchParams(window.location.search);
  const hadTokenParam = params.has("token");
  if (hadTokenParam) {
    params.delete("token");
  }

  els.matchIdInput.value = params.get("id") || "";
  setCustomFieldImage(params.get("field"));

  const wsSource = readWebSocketSource(params);
  const wsFromLink = wsSource.value
    ? normalizeWebSocketBase(wsSource.value) || wsSource.value
    : "";
  if (wsFromLink) {
    localStorage.setItem("bamjoballLiveWs", wsFromLink);
  }

  if (hadTokenParam || wsSource.shouldClean) {
    params.delete("w");
    params.delete("ws");
    params.delete("socket");
    replaceCurrentQuery(params);
  }

  state.webSocketBase =
    wsFromLink ||
    localStorage.getItem("bamjoballLiveWs") ||
    deriveDefaultWebSocketBase() ||
    "";

  els.connectButton.addEventListener("click", () => connectFromInputs());

  if (els.matchIdInput.value && state.webSocketBase) {
    connectFromInputs({
      availabilityRetries: initialAvailabilityRetries,
      connectImmediately: true
    });
  } else if (els.matchIdInput.value) {
    setStatus("Нет адреса сервера");
  }
}

async function connectFromInputs({
  availabilityRetries = 0,
  connectImmediately = false
} = {}) {
  const matchId = els.matchIdInput.value.trim();
  const wsValue = state.webSocketBase.trim();
  const url = buildWebSocketUrl(wsValue, matchId);

  if (!matchId || !url) {
    setStatus("Не заполнено подключение");
    return;
  }

  const attemptId = ++state.connectionAttempt;
  closeCurrentSocket();
  resetMatchView();

  const wsBase = normalizeWebSocketBase(wsValue) || wsValue;
  localStorage.setItem("bamjoballLiveWs", wsBase);
  if (wsBase !== wsValue) {
    state.webSocketBase = wsBase;
  }

  setStatus("Проверка матча");
  els.connectButton.disabled = true;

  if (connectImmediately) {
    openSocket(url, attemptId);
    verifyInitialConnection(url, attemptId, availabilityRetries);
    return;
  }

  const availability = await checkMatchAvailability(url, availabilityRetries);
  if (attemptId !== state.connectionAttempt) {
    return;
  }

  if (availability === "not_found") {
    els.connectButton.disabled = false;
    setStatus("Матч не найден");
    setPhase("Не найден");
    return;
  }

  openSocket(url, attemptId);
}

async function verifyInitialConnection(url, attemptId, availabilityRetries) {
  const availability = await checkMatchAvailability(url, availabilityRetries);
  if (attemptId !== state.connectionAttempt ||
      state.socket?.readyState === WebSocket.OPEN ||
      availability !== "not_found") {
    return;
  }

  closeCurrentSocket();
  els.connectButton.disabled = false;
  setStatus("Матч не найден");
  setPhase("Не найден");
}

function openSocket(url, attemptId = state.connectionAttempt) {
  clearTimeout(state.reconnectTimer);
  state.shouldReconnect = true;

  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
  }

  setStatus("Подключение");
  els.connectButton.disabled = true;

  const socket = new WebSocket(url);
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.timelineRequestInFlight = false;
    setStatus("Подключено");
    els.connectButton.disabled = false;
    sendClientMessage({ type: "resume" });
  });

  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      pushEvent({ tick: "-", kind: "error", text: "Сервер прислал неверный JSON." });
      return;
    }

    handleServerMessage(payload);
  });

  socket.addEventListener("close", () => {
    state.timelineRequestInFlight = false;
    if (attemptId !== state.connectionAttempt) {
      return;
    }

    els.connectButton.disabled = false;
    if (!state.shouldReconnect || getStatusCode() === "finished") {
      setStatus(getStatusCode() === "finished" ? "МАТЧ ОКОНЧЕН" : "Отключено");
      return;
    }

    setStatus("Переподключение");
    state.reconnectTimer = setTimeout(() => openSocket(url, attemptId), reconnectDelayMs);
  });

  socket.addEventListener("error", () => {
    state.timelineRequestInFlight = false;
    setStatus("Ошибка подключения");
  });
}

function sendClientMessage(message) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
    return true;
  }

  return false;
}

function closeCurrentSocket() {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.timelineRequestTimer);
  state.timelineRequestInFlight = false;
  state.shouldReconnect = false;

  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
    state.socket = null;
  }
}

function resetMatchView() {
  for (const timer of state.pendingTimers) {
    clearTimeout(timer);
  }

  state.pendingTimers.clear();
  clearTimeout(state.timelineRequestTimer);
  state.timelineRequestTimer = null;
  state.timelineRequestInFlight = false;
  state.playbackTimeMs = 0;
  state.playbackLastNow = 0;
  state.playbackInitialized = false;
  state.serverFinished = false;
  state.finalScore = null;
  state.info = null;
  state.usesTimeline = false;
  state.previousFrame = null;
  state.targetFrame = null;
  state.lastFrameTimeMs = -1;
  state.ballPhysics = null;
  state.events = [];
  state.playerMotion.clear();
  state.eventKeys.clear();
  state.effectKeys.clear();
  state.scheduledFrameKeys.clear();
  state.visualFrameKeys.clear();
  state.playerMotionKeys.clear();
  state.physicsEventKeys.clear();
  state.timelineEventKeys.clear();
  state.goalEventKeys.clear();
  state.visualFrames = [];
  state.timelineFrames = [];
  state.playerMotions = [];
  state.timelineEvents = [];
  state.goalEvents = [];
  state.physicsEvents = [];
  els.events.replaceChildren();
  els.effectsLayer?.replaceChildren();
  if (els.goalOverlay) {
    els.goalOverlay.hidden = true;
  }
  if (els.matchEndOverlay) {
    els.matchEndOverlay.hidden = true;
  }
}

async function checkMatchAvailability(webSocketUrl, notFoundRetries = 0) {
  const snapshotUrl = buildSnapshotUrl(webSocketUrl);
  if (!snapshotUrl || typeof fetch !== "function") {
    return "unknown";
  }

  for (let attempt = 0; attempt <= notFoundRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(snapshotUrl, {
        cache: "no-store",
        signal: controller.signal
      });

      if (response.status !== 404) {
        return "ok";
      }
    } catch {
      return "unknown";
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < notFoundRetries) {
      await new Promise((resolve) =>
        setTimeout(resolve, availabilityRetryDelayMs));
    }
  }

  return "not_found";
}

function handleServerMessage(message) {
  switch (message.type) {
    case "hello":
      updateServerTime(message.serverTime);
      break;

    case "match_info":
      state.info = message;
      state.usesTimeline = Number(message.protocol || 0) >= 2;
      applyFieldGeometry(message.field);
      state.animationDurationMs = getTickAnimationDuration();
      els.matchIdLabel.textContent = message.matchId || "-";
      setPhase(message.status);
      updateTick(state.targetFrame?.tick || 0);
      if (state.usesTimeline) {
        startTimelineRequests();
      }
      break;

    case "snapshot":
      updateServerTime(message.serverTime);
      setPhase(message.status);
      adoptFrame(message, message.type);
      break;

    case "tick":
      if (state.usesTimeline) {
        break;
      }

      updateServerTime(message.serverTime);
      setPhase(message.status);
      adoptFrame(message, message.type);
      break;

    case "timeline":
      state.timelineRequestInFlight = false;
      updateServerTime(message.serverTime);
      setPhase(message.status);
      adoptTimeline(message);
      break;

    case "finished":
      state.timelineRequestInFlight = false;
      updateServerTime(message.serverTime);
      mergeFinalVisualFrames(message);
      state.serverFinished = true;
      state.finalScore = message.score || null;
      if (state.info) {
        state.info = { ...state.info, status: "finished" };
      }
      queueTimelineEvents(message.events || []);
      state.shouldReconnect = false;
      clearTimeout(state.timelineRequestTimer);
      break;

    case "pong":
      updateServerTime(message.serverTime);
      break;

    case "error":
      state.timelineRequestInFlight = false;
      if (message.code === "match_not_found") {
        closeCurrentSocket();
        setStatus("Матч не найден");
        setPhase("Не найден");
        return;
      }

      pushEvent({ tick: "-", kind: "error", text: message.message || message.code || "Ошибка сервера." });
      setStatus("Ошибка сервера");
      break;

    default:
      pushEvent({ tick: "-", kind: "message", text: `Неизвестное сообщение: ${message.type || "-"}` });
      break;
  }
}

function applyFieldGeometry(value = {}) {
  field.lanes = positiveNumber(value.lanes, field.lanes);
  field.columns = positiveNumber(value.columns, field.columns);
  field.coordinateMode = value.coordinateMode || field.coordinateMode;
  field.aspectRatio = positiveNumber(
    value.aspectRatio,
    field.columns / field.lanes
  );
  field.goalDepth = positiveNumber(value.goalDepth, field.goalDepth);
  field.goalInteriorHeight = positiveNumber(
    value.goalInteriorHeight,
    field.goalInteriorHeight
  );
  field.playableColumns = positiveNumber(
    value.playableColumns,
    field.columns + field.goalDepth * 2
  );
  field.playableAspectRatio = positiveNumber(
    value.playableAspectRatio,
    field.playableColumns / field.lanes
  );
  field.goalMouthHeight = positiveNumber(
    value.goalMouthHeight,
    field.goalMouthHeight
  );
  field.goalkeeperAreaDepth = positiveNumber(
    value.goalkeeperAreaDepth,
    field.goalkeeperAreaDepth
  );
  field.goalkeeperAreaHeight = positiveNumber(
    value.goalkeeperAreaHeight,
    field.goalkeeperAreaHeight
  );

  els.pitch.style.setProperty(
    "--field-aspect",
    String(field.playableAspectRatio)
  );
  els.pitch.style.setProperty(
    "--field-inset",
    `${field.goalDepth / field.playableColumns * 100}%`
  );
  els.pitch.style.setProperty(
    "--field-width",
    `${field.columns / field.playableColumns * 100}%`
  );
  els.pitch.style.setProperty(
    "--goalkeeper-area-depth",
    `${field.goalkeeperAreaDepth / field.playableColumns * 100}%`
  );
  els.pitch.style.setProperty(
    "--goalkeeper-area-height",
    `${field.goalkeeperAreaHeight / field.lanes * 100}%`
  );
  els.pitch.style.setProperty(
    "--goal-mouth-within-area",
    `${field.goalMouthHeight / field.goalkeeperAreaHeight * 100}%`
  );
  els.pitch.style.setProperty(
    "--goal-interior-depth",
    `${field.goalDepth / field.playableColumns * 100}%`
  );
  els.pitch.style.setProperty(
    "--goal-interior-height",
    `${field.goalInteriorHeight / field.lanes * 100}%`
  );
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function startTimelineRequests() {
  clearTimeout(state.timelineRequestTimer);
  requestTimelineWindow();
}

function requestTimelineWindow() {
  if (!state.info || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  scheduleNextTimelineRequest();

  if (state.timelineRequestInFlight) {
    return;
  }

  const startedAtMs = Date.parse(state.info.startedAt || "");
  if (Number.isFinite(startedAtMs)) {
    const playbackMs = getPlaybackTimeMs();
    const { overlapMs, lookAheadMs } = getTimelineWindowConfig();
    const durationMs = Number(state.info.durationMs || 0);
    const bufferedUntilMs = getBufferedUntilMs();
    const toMs = durationMs > 0
      ? Math.min(durationMs, playbackMs + lookAheadMs)
      : playbackMs + lookAheadMs;

    const requestingFinalTail = durationMs > 0 &&
      toMs >= durationMs &&
      bufferedUntilMs < durationMs;
    if (!requestingFinalTail &&
        bufferedUntilMs >= toMs - getBufferRefillThresholdMs(lookAheadMs)) {
      return;
    }

    const fromMs = bufferedUntilMs < 0
      ? Math.max(0, playbackMs - overlapMs)
      : Math.max(0, bufferedUntilMs - overlapMs);
    if (toMs <= fromMs) {
      return;
    }

    state.timelineRequestInFlight = sendClientMessage({
      type: "timeline",
      fromMs,
      toMs
    });
  } else {
    state.timelineRequestInFlight = sendClientMessage({ type: "timeline" });
  }
}

function scheduleNextTimelineRequest() {
  const intervalMs = Math.min(Number(state.info.timeline?.chunkIntervalMs || 700), 700);
  state.timelineRequestTimer = setTimeout(requestTimelineWindow, Math.max(250, intervalMs));
}

function getBufferedUntilMs() {
  const frames = state.visualFrames.length > 0
    ? state.visualFrames
    : state.timelineFrames;
  return frames.length === 0 ? -1 : frameTime(frames[frames.length - 1]);
}

function getBufferRefillThresholdMs(lookAheadMs) {
  return Math.max(1200, Math.min(2500, lookAheadMs * 0.4));
}

function adoptTimeline(message) {
  mergeVisualFrames((message.visualFrames || []).map(normalizeFrame));
  if (Number(state.info?.protocol || 0) < 4) {
    mergeTimelineFrames((message.frames || []).map(normalizeFrame));
    mergePlayerMotions(message.motions || []);
    queueBallPhysicsEvents(message.physics || []);
  }

  queueTimelineEvents(message.events || []);
}

function mergeFinalVisualFrames(message) {
  const finalFrames = (message.visualFrames || []).map(normalizeFrame);
  if (finalFrames.length > 0) {
    mergeVisualFrames(finalFrames);
    return;
  }

  const source = state.visualFrames[state.visualFrames.length - 1] || state.targetFrame;
  const durationMs = Number(state.info?.durationMs || 0);
  if (!source || durationMs <= 0) {
    return;
  }

  mergeVisualFrames([{
    ...source,
    key: `visual:${durationMs}`,
    timeMs: durationMs,
    tick: Number(message.tick ?? state.info?.totalTicks ?? source.tick ?? 0),
    status: "finished",
    score: message.score || source.score
  }]);
}

function mergeVisualFrames(frames) {
  for (const frame of frames) {
    const key = String(frame.key ?? frame.timeMs ?? frame.tick);
    if (state.visualFrameKeys.has(key)) {
      continue;
    }

    state.visualFrameKeys.add(key);
    state.visualFrames.push(frame);
  }

  state.visualFrames.sort((left, right) => frameTime(left) - frameTime(right));
  pruneTimelineBuffers();
}

function mergeTimelineFrames(frames) {
  for (const frame of frames) {
    const key = String(frame.key ?? frame.timeMs ?? frame.tick);
    if (state.scheduledFrameKeys.has(key)) {
      continue;
    }

    state.scheduledFrameKeys.add(key);
    state.timelineFrames.push(frame);
  }

  state.timelineFrames.sort((left, right) => frameTime(left) - frameTime(right));
  pruneTimelineBuffers();
}

function mergePlayerMotions(motions) {
  for (const motion of motions || []) {
    const normalized = normalizePlayerMotion(motion);
    if (!normalized) {
      continue;
    }

    const key = normalized.key;
    if (state.playerMotionKeys.has(key)) {
      continue;
    }

    state.playerMotionKeys.add(key);
    state.playerMotions.push(normalized);
  }

  state.playerMotions.sort((left, right) => left.fromMs - right.fromMs);
}

function normalizePlayerMotion(motion) {
  const fromMs = Number(motion.fromMs);
  const toMs = Number(motion.toMs);
  const playerId = motion.playerId ?? motion.id;
  if (!Number.isFinite(fromMs) ||
      !Number.isFinite(toMs) ||
      playerId === null ||
      playerId === undefined) {
    return null;
  }

  return {
    key: String(motion.key || `${playerId}:${fromMs}:${toMs}:${motion.fromLane},${motion.fromColumn}:${motion.toLane},${motion.toColumn}`),
    playerId,
    fromMs,
    toMs: Math.max(fromMs + 1, toMs),
    fromLane: Number(motion.fromLane || 0),
    fromColumn: Number(motion.fromColumn || 0),
    toLane: Number(motion.toLane || 0),
    toColumn: Number(motion.toColumn || 0),
    team: motion.team || null,
    role: motion.role || null,
    hasBall: Boolean(motion.hasBall)
  };
}

function pruneTimelineBuffers() {
  const keepAfterMs = Math.max(0, getPlaybackTimeMs() - getTimelineRetentionMs());

  state.visualFrames = state.visualFrames.filter((frame) => frameTime(frame) >= keepAfterMs);
  state.timelineFrames = state.timelineFrames.filter((frame) => frameTime(frame) >= keepAfterMs);
  state.playerMotions = state.playerMotions.filter((motion) => motion.toMs >= keepAfterMs);
  state.timelineEvents = state.timelineEvents.filter((event) => eventTime(event) >= keepAfterMs);
  state.physicsEvents = state.physicsEvents.filter((event) => eventTime(event) >= keepAfterMs);
}

function getTimelineWindowConfig() {
  const serverOverlapMs = Number(state.info?.timeline?.overlapMs || 0);
  const serverLookAheadMs = Number(state.info?.timeline?.lookAheadMs || 0);

  return {
    overlapMs: Math.max(serverOverlapMs, 300),
    lookAheadMs: Math.max(serverLookAheadMs, 5000)
  };
}

function getTimelineRetentionMs() {
  const tickDurationMs = getTimelineTickDurationMs();
  return Math.max(15000, Math.ceil(tickDurationMs * 5));
}

function getTimelineTickDurationMs() {
  return Math.max(1, Number(state.info?.tickDurationMs || state.animationDurationMs || 2800));
}

function frameTime(frame) {
  const time = Number(frame.timeMs);
  if (Number.isFinite(time)) {
    return time;
  }

  const tickDurationMs = Number(state.info?.tickDurationMs || state.animationDurationMs || 2800);
  return Number(frame.tick || 0) * tickDurationMs;
}

function eventTime(event) {
  const time = Number(event.timeMs);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function adoptFrame(message, sourceType) {
  const frame = normalizeFrame(message);
  adoptNormalizedFrame(frame, sourceType);
}

function adoptNormalizedFrame(frame, sourceType) {
  const currentVisual = getInterpolatedFrame(performance.now());

  state.previousFrame = currentVisual || frame;
  state.targetFrame = frame;
  state.animationStartedAt = performance.now();
  state.animationDurationMs =
    sourceType === "snapshot"
      ? Math.min(state.animationDurationMs, 700)
      : getTickAnimationDuration();
  if (sourceType === "timeline" || !state.usesTimeline) {
    state.lastFrameTimeMs = Number.isFinite(frame.timeMs)
      ? frame.timeMs
      : state.lastFrameTimeMs;
  }

  if (sourceType === "snapshot" && !state.usesTimeline) {
    resetBallPhysicsFromFrame(frame);
  } else if (sourceType === "timeline" && !state.ballPhysics) {
    resetBallPhysicsFromFrame(frame);
  }

  updateScore(frame.score);
  updateTick(frame.tick);
  updateRosters(frame.players);
  if (!state.usesTimeline && sourceType !== "timeline") {
    queueFrameEvents(frame, sourceType);
  }
}

function render(now) {
  renderFrame(now);
  requestAnimationFrame(render);
}

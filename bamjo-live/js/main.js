import { els, field, reconnectDelayMs, state } from "./state.js";
import {
  buildSnapshotUrl,
  buildWebSocketUrl,
  deriveDefaultWebSocketBase,
  normalizeWebSocketBase,
  readWebSocketSource,
  replaceCurrentQuery
} from "./network.js";
import { normalizeFrame } from "./frames.js";
import { pushEvent, queueFrameEvents, queueTimelineEvents } from "./events.js";
import { queueBallPhysicsEvents, resetBallPhysicsFromFrame } from "./ballPhysics.js";
import { scheduleAtMatchTime } from "./timeline.js";
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
} from "./render.js";

init();
requestAnimationFrame(render);

function init() {
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

  els.connectButton.addEventListener("click", connectFromInputs);

  if (els.matchIdInput.value && state.webSocketBase) {
    connectFromInputs();
  } else if (els.matchIdInput.value) {
    setStatus("Нет адреса сервера");
  }
}

async function connectFromInputs() {
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

  const availability = await checkMatchAvailability(url);
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
    setStatus("Ошибка подключения");
  });
}

function sendClientMessage(message) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(message));
  }
}

function closeCurrentSocket() {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.timelineRequestTimer);
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
  state.info = null;
  state.usesTimeline = false;
  state.previousFrame = null;
  state.targetFrame = null;
  state.lastFrameTimeMs = -1;
  state.ballPhysics = null;
  state.events = [];
  state.eventKeys.clear();
  state.effectKeys.clear();
  state.scheduledFrameKeys.clear();
  state.physicsEventKeys.clear();
  els.events.replaceChildren();
  els.effectsLayer?.replaceChildren();
}

async function checkMatchAvailability(webSocketUrl) {
  const snapshotUrl = buildSnapshotUrl(webSocketUrl);
  if (!snapshotUrl || typeof fetch !== "function") {
    return "unknown";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(snapshotUrl, {
      cache: "no-store",
      signal: controller.signal
    });

    return response.status === 404 ? "not_found" : "ok";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

function handleServerMessage(message) {
  switch (message.type) {
    case "hello":
      updateServerTime(message.serverTime);
      break;

    case "match_info":
      state.info = message;
      state.usesTimeline = Number(message.protocol || 0) >= 2;
      field.lanes = message.field?.lanes || field.lanes;
      field.columns = message.field?.columns || field.columns;
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
      updateServerTime(message.serverTime);
      setPhase(message.status);
      adoptTimeline(message);
      break;

    case "finished":
      updateServerTime(message.serverTime);
      setPhase("finished");
      setStatus("МАТЧ ОКОНЧЕН");
      state.shouldReconnect = false;
      clearTimeout(state.timelineRequestTimer);
      updateScore(message.score);
      updateTick(message.tick);
      break;

    case "pong":
      updateServerTime(message.serverTime);
      break;

    case "error":
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

function startTimelineRequests() {
  clearTimeout(state.timelineRequestTimer);
  requestTimelineWindow();
}

function requestTimelineWindow() {
  if (!state.info || !state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  sendClientMessage({ type: "timeline" });

  const intervalMs = Number(state.info.timeline?.chunkIntervalMs || 800);
  state.timelineRequestTimer = setTimeout(requestTimelineWindow, Math.max(250, intervalMs));
}

function adoptTimeline(message) {
  for (const frameMessage of message.frames || []) {
    scheduleTimelineFrame(normalizeFrame(frameMessage));
  }

  queueTimelineEvents(message.events || []);
  queueBallPhysicsEvents(message.physics || []);
}

function scheduleTimelineFrame(frame) {
  const key = String(frame.timeMs ?? frame.tick);
  if (state.scheduledFrameKeys.has(key)) {
    return;
  }

  if (Number.isFinite(frame.timeMs) && frame.timeMs < state.lastFrameTimeMs - 50) {
    return;
  }

  state.scheduledFrameKeys.add(key);
  scheduleAtMatchTime(frame.timeMs, () => {
    state.scheduledFrameKeys.delete(key);
    if (Number.isFinite(frame.timeMs) && frame.timeMs < state.lastFrameTimeMs - 50) {
      return;
    }

    adoptNormalizedFrame(frame, "timeline");
  });
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
  state.lastFrameTimeMs = Number.isFinite(frame.timeMs)
    ? frame.timeMs
    : state.lastFrameTimeMs;

  if (sourceType === "snapshot") {
    resetBallPhysicsFromFrame(frame);
  }

  updateScore(frame.score);
  updateTick(frame.tick);
  updateRosters(frame.players);
  if (sourceType !== "timeline") {
    queueFrameEvents(frame, sourceType);
  }
}

function render(now) {
  renderFrame(now);
  requestAnimationFrame(render);
}

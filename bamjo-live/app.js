(function () {
  const field = { lanes: 3, columns: 7 };
  const maxEvents = 36;
  const reconnectDelayMs = 2500;
  const tickAnimationStretch = 1;

  const els = {
    matchStatus: document.getElementById("matchStatus"),
    redScore: document.getElementById("redScore"),
    blueScore: document.getElementById("blueScore"),
    tickLabel: document.getElementById("tickLabel"),
    progressBar: document.getElementById("progressBar"),
    matchIdInput: document.getElementById("matchIdInput"),
    connectButton: document.getElementById("connectButton"),
    phaseLabel: document.getElementById("phaseLabel"),
    matchIdLabel: document.getElementById("matchIdLabel"),
    serverTimeLabel: document.getElementById("serverTimeLabel"),
    pitch: document.getElementById("pitch"),
    playersLayer: document.getElementById("playersLayer"),
    objectsLayer: document.getElementById("objectsLayer"),
    effectsLayer: document.getElementById("effectsLayer"),
    ball: document.getElementById("ball"),
    redRoster: document.getElementById("redRoster"),
    blueRoster: document.getElementById("blueRoster"),
    events: document.getElementById("events")
  };

  const state = {
    socket: null,
    reconnectTimer: null,
    shouldReconnect: false,
    info: null,
    previousFrame: null,
    targetFrame: null,
    animationStartedAt: 0,
    animationDurationMs: 2800,
    connectionAttempt: 0,
    webSocketBase: "",
    playerEls: new Map(),
    objectEls: new Map(),
    eventKeys: new Set(),
    effectKeys: new Set(),
    pendingTimers: new Set(),
    events: []
  };

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
    state.info = null;
    state.previousFrame = null;
    state.targetFrame = null;
    state.events = [];
    state.eventKeys.clear();
    state.effectKeys.clear();
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
        field.lanes = message.field?.lanes || field.lanes;
        field.columns = message.field?.columns || field.columns;
        state.animationDurationMs = getTickAnimationDuration();
        els.matchIdLabel.textContent = message.matchId || "-";
        setPhase(message.status);
        updateTick(state.targetFrame?.tick || 0);
        break;

      case "snapshot":
      case "tick":
        updateServerTime(message.serverTime);
        setPhase(message.status);
        adoptFrame(message, message.type);
        break;

      case "finished":
        updateServerTime(message.serverTime);
        setPhase("finished");
        setStatus("МАТЧ ОКОНЧЕН");
        state.shouldReconnect = false;
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

  function adoptFrame(message, sourceType) {
    const frame = normalizeFrame(message);
    const currentVisual = getInterpolatedFrame(performance.now());

    state.previousFrame = currentVisual || frame;
    state.targetFrame = frame;
    state.animationStartedAt = performance.now();
    state.animationDurationMs =
      sourceType === "snapshot"
        ? Math.min(state.animationDurationMs, 700)
        : getTickAnimationDuration();

    updateScore(frame.score);
    updateTick(frame.tick);
    updateRosters(frame.players);
    queueFrameEvents(frame, sourceType);
  }

  function normalizeFrame(message) {
    return {
      tick: Number(message.tick || 0),
      status: message.status || "running",
      score: {
        red: Number(message.score?.red || 0),
        blue: Number(message.score?.blue || 0)
      },
      ball: {
        lane: Number(message.ball?.lane || 0),
        column: Number(message.ball?.column || 0),
        holderPlayerId: normalizeId(message.ball?.holderPlayerId),
        lastTouchPlayerId: normalizeId(message.ball?.lastTouchPlayerId),
        power: Number(message.ball?.power || 0),
        remainingSteps: Number(message.ball?.remainingSteps || 0),
        laneVelocity: Number(message.ball?.laneVelocity || 0),
        columnVelocity: Number(message.ball?.columnVelocity || 0)
      },
      players: (message.players || []).map((player) => ({
        id: normalizeId(player.id),
        nickname: String(player.nickname || player.id || "-"),
        team: player.team === "blue" ? "blue" : "red",
        hero: String(player.hero || "shaman"),
        role: String(player.role || "-"),
        cardId: player.cardId || null,
        lane: Number(player.lane || 0),
        column: Number(player.column || 0),
        hasBall: Boolean(player.hasBall)
      })),
      objects: (message.objects || []).map((object) => ({
        id: normalizeId(object.id),
        type: String(object.type || "object"),
        team: object.team === "blue" ? "blue" : "red",
        lane: Number(object.lane || 0),
        column: Number(object.column || 0),
        remainingTicks: Number(object.remainingTicks || 0)
      })),
      events: (message.events || []).map((event) => ({
        tick: event.tick ?? message.tick ?? "-",
        kind: String(event.kind || "event"),
        team: event.team || null,
        actor: event.actor || null,
        hero: event.hero || null,
        text: String(event.text || ""),
        lane: Number.isFinite(Number(event.lane)) ? Number(event.lane) : null,
        column: Number.isFinite(Number(event.column)) ? Number(event.column) : null,
        tags: (event.tags || []).map((tag) => String(tag)),
        visible: event.visible !== false
      }))
    };
  }

  function render(now) {
    updateMatchStatus();
    const frame = getInterpolatedFrame(now);
    if (frame) {
      updateTick(frame.visualTick ?? frame.tick);
      renderPlayers(frame);
      renderObjects(frame);
      renderBall(frame);
    }

    requestAnimationFrame(render);
  }

  function getInterpolatedFrame(now) {
    if (!state.targetFrame) {
      return null;
    }

    if (!state.previousFrame) {
      return state.targetFrame;
    }

    const t = clamp((now - state.animationStartedAt) / state.animationDurationMs, 0, 1);
    const previousPlayers = new Map(state.previousFrame.players.map((player) => [String(player.id), player]));
    const players = state.targetFrame.players.map((player) => {
      const previous = previousPlayers.get(String(player.id)) || player;
      return {
        ...player,
        lane: lerp(previous.lane, player.lane, t),
        column: lerp(previous.column, player.column, t)
      };
    });

    const visualTick = lerp(state.previousFrame.tick, state.targetFrame.tick, t);

    return {
      ...state.targetFrame,
      tick: visualTick,
      visualTick,
      players,
      ball: interpolateBall(state.previousFrame, state.targetFrame, players, t)
    };
  }

  function getTickAnimationDuration() {
    return clamp(
      (state.info?.tickDurationMs || state.animationDurationMs || 2800) * tickAnimationStretch,
      450,
      12000
    );
  }

  function interpolateBall(previousFrame, targetFrame, visualPlayers, t) {
    const previousBall = previousFrame.ball || targetFrame.ball;
    const previousHolderId = previousBall.holderPlayerId;
    const targetHolderId = targetFrame.ball.holderPlayerId;

    if (targetHolderId !== null &&
        previousHolderId !== null &&
        String(previousHolderId) === String(targetHolderId)) {
      const holder = findPlayer(visualPlayers, targetHolderId);
      if (holder) {
        return {
          ...targetFrame.ball,
          lane: holder.lane,
          column: holder.column
        };
      }
    }

    const catching = targetHolderId !== null && String(previousHolderId) !== String(targetHolderId);
    if (catching && t >= 0.88) {
      const holder = findPlayer(visualPlayers, targetHolderId);
      if (holder) {
        return {
          ...targetFrame.ball,
          lane: holder.lane,
          column: holder.column
        };
      }
    }

    const targetBall = projectFreeBall(targetFrame.ball);
    return {
      ...targetBall,
      holderPlayerId: catching ? null : targetFrame.ball.holderPlayerId,
      lane: lerp(previousBall.lane, targetBall.lane, t),
      column: lerp(previousBall.column, targetBall.column, t)
    };
  }

  function projectFreeBall(ball) {
    if (ball.holderPlayerId !== null || ball.remainingSteps <= 0) {
      return ball;
    }

    const steps = Math.max(1, Math.min(2, ball.remainingSteps, Math.max(1, ball.power || 1)));
    return {
      ...ball,
      lane: clamp(ball.lane + Math.sign(ball.laneVelocity || 0) * steps, 0, field.lanes - 1),
      column: clamp(ball.column + Math.sign(ball.columnVelocity || 0) * steps, 0, field.columns - 1)
    };
  }

  function renderPlayers(frame) {
    const present = new Set();

    for (const player of frame.players) {
      const key = String(player.id);
      present.add(key);

      let el = state.playerEls.get(key);
      if (!el) {
        el = createPlayerElement(player);
        state.playerEls.set(key, el);
        els.playersLayer.appendChild(el);
      }

      const position = cellToPercent(player.lane, player.column);
      const hasControlledBall = isBallAtPlayer(frame.ball, player);
      el.style.left = `${position.x}%`;
      el.style.top = `${position.y}%`;
      el.style.zIndex = String(hasControlledBall ? 5 : 4);
      el.style.setProperty("--team-color", teamColor(player.team));
      el.classList.toggle("hasBall", hasControlledBall);
      el.querySelector(".playerIcon").style.backgroundImage = `url("${heroImage(player.hero)}")`;
      el.querySelector(".playerLabel").textContent = player.nickname;
    }

    for (const [key, el] of state.playerEls) {
      if (!present.has(key)) {
        el.remove();
        state.playerEls.delete(key);
      }
    }
  }

  function isBallAtPlayer(ball, player) {
    return Boolean(ball && ball.holderPlayerId !== null && String(ball.holderPlayerId) === String(player.id));
  }

  function createPlayerElement(player) {
    const el = document.createElement("div");
    el.className = `player ${player.team}`;
    el.dataset.id = player.id;

    const label = document.createElement("div");
    label.className = "playerLabel";
    label.textContent = player.nickname;

    const icon = document.createElement("div");
    icon.className = "playerIcon";

    el.append(label, icon);
    return el;
  }

  function renderObjects(frame) {
    const present = new Set();

    for (const object of frame.objects) {
      const key = `${object.type}:${object.id}`;
      present.add(key);

      let el = state.objectEls.get(key);
      if (!el) {
        el = document.createElement("div");
        el.className = `object ${object.type}`;
        state.objectEls.set(key, el);
        els.objectsLayer.appendChild(el);
      }

      const position = cellToPercent(object.lane, object.column);
      el.style.left = `${position.x}%`;
      el.style.top = `${position.y}%`;
      el.style.setProperty("--team-color", teamColor(object.team));
    }

    for (const [key, el] of state.objectEls) {
      if (!present.has(key)) {
        el.remove();
        state.objectEls.delete(key);
      }
    }
  }

  function renderBall(frame) {
    const position = cellToPercent(frame.ball.lane, frame.ball.column);
    els.ball.style.setProperty("--ball-x", `${position.x}%`);
    els.ball.style.setProperty("--ball-y", `${position.y}%`);
  }

  function queueFrameEvents(frame, sourceType) {
    for (const event of frame.events) {
      const delay = eventDelayMs(event, sourceType);
      const timer = setTimeout(() => {
        state.pendingTimers.delete(timer);
        if (shouldSpawnEffect(event)) {
          spawnEffectOnce(event, frame);
        }
        if (event.visible !== false) {
          pushEvent(event);
        }
      }, delay);

      state.pendingTimers.add(timer);
    }
  }

  function eventDelayMs(event, sourceType) {
    if (sourceType === "snapshot") {
      return 0;
    }

    if (isResolutionEvent(event)) {
      return Math.round(state.animationDurationMs * 0.82);
    }

    return 0;
  }

  function isResolutionEvent(event) {
    return event.kind === "interception" ||
      event.kind === "tackle" ||
      event.kind === "save" ||
      event.kind === "goal" ||
      event.kind === "loose_ball";
  }

  function spawnFrameEffects(frame) {
    for (const event of frame.events) {
      if (!shouldSpawnEffect(event)) {
        continue;
      }

      spawnEffectOnce(event, frame);
    }
  }

  function spawnEffectOnce(event, frame) {
    const key = eventKey(event);
    if (state.effectKeys.has(key)) {
      return;
    }

    state.effectKeys.add(key);
    trimSet(state.effectKeys, 160);
    spawnEffect(event, frame);
  }

  function shouldSpawnEffect(event) {
    return event.kind === "ability" ||
      event.kind === "object_created" ||
      event.kind === "shot" ||
      event.kind === "pass" ||
      event.kind === "goal" ||
      event.kind === "save" ||
      event.kind === "interception" ||
      event.kind === "tackle" ||
      event.kind === "repick";
  }

  function spawnEffect(event, frame) {
    if (!els.effectsLayer) {
      return;
    }

    const point = effectPoint(event, frame);
    const position = cellToPercent(point.lane, point.column);
    const el = document.createElement("div");
    el.className = `effect ${effectClass(event)}`;
    el.style.left = `${position.x}%`;
    el.style.top = `${position.y}%`;
    el.style.setProperty("--team-color", event.team ? teamColor(event.team) : "var(--gold)");
    els.effectsLayer.appendChild(el);
    setTimeout(() => el.remove(), effectDuration(event));
  }

  function effectPoint(event, frame) {
    if (event.lane !== null && event.column !== null) {
      return { lane: event.lane, column: event.column };
    }

    const actor = frame.players.find((player) => event.actor && player.nickname === event.actor);
    if (actor) {
      return { lane: actor.lane, column: actor.column };
    }

    return { lane: frame.ball.lane, column: frame.ball.column };
  }

  function effectClass(event) {
    const hero = String(event.hero || "").toLowerCase();
    const tags = new Set((event.tags || []).map((tag) => tag.toLowerCase()));
    const parts = [];

    if (event.kind) {
      parts.push(`kind-${event.kind}`);
    }
    if (hero) {
      parts.push(`hero-${hero}`);
    }
    for (const tag of ["shot", "pass", "power", "curve", "slamshot", "hook", "portal", "totem", "blackhole", "goal", "save", "dash", "blink", "pull", "swap", "water", "aoe", "repick"]) {
      if (tags.has(tag)) {
        parts.push(`tag-${tag}`);
      }
    }

    return parts.join(" ");
  }

  function effectDuration(event) {
    if (event.kind === "goal") {
      return 1800;
    }

    if (event.kind === "object_created") {
      return 1300;
    }

    return 1050;
  }

  function updateRosters(players) {
    els.redRoster.replaceChildren(...players.filter((player) => player.team === "red").map(createRosterCard));
    els.blueRoster.replaceChildren(...players.filter((player) => player.team === "blue").map(createRosterCard));
  }

  function createRosterCard(player) {
    const card = document.createElement("div");
    card.className = "rosterCard";
    card.style.setProperty("--team-color", teamColor(player.team));

    const name = document.createElement("div");
    name.className = "rosterName";

    const img = document.createElement("img");
    img.src = heroImage(player.hero);
    img.alt = "";
    img.loading = "lazy";

    const label = document.createElement("span");
    label.textContent = player.nickname;

    const meta = document.createElement("div");
    meta.className = "rosterMeta";
    meta.textContent = `${player.role} · ${player.hero}`;

    name.append(img, label);
    card.append(name, meta);
    return card;
  }

  function pushEvent(event) {
    if (!event.text) {
      return;
    }

    const key = eventKey(event);
    if (state.eventKeys.has(key)) {
      return;
    }

    state.eventKeys.add(key);
    trimSet(state.eventKeys, maxEvents * 4);

    state.events.unshift(event);
    if (state.events.length > maxEvents) {
      state.events.length = maxEvents;
    }

    els.events.replaceChildren(...state.events.map(createEventElement));
  }

  function createEventElement(event) {
    const el = document.createElement("div");
    el.className = "event";
    el.style.setProperty("--team-color", event.team ? teamColor(event.team) : "var(--gold)");

    const meta = document.createElement("div");
    meta.className = "eventMeta";
    meta.textContent = `${event.tick} · ${event.kind}${event.hero ? ` · ${event.hero}` : ""}`;

    const text = document.createElement("div");
    text.className = "eventText";
    text.textContent = event.text;

    el.append(meta, text);
    return el;
  }

  function eventKey(event) {
    return [
      event.tick ?? "-",
      event.kind || "-",
      event.team || "-",
      event.actor || "-",
      event.hero || "-",
      event.text || "-"
    ].join("|");
  }

  function updateScore(score) {
    if (!score) {
      return;
    }

    els.redScore.textContent = String(score.red ?? 0);
    els.blueScore.textContent = String(score.blue ?? 0);
  }

  function updateTick(tick) {
    const totalTicks = state.info?.totalTicks || 64;
    const durationMs = getMatchDurationMs();
    const elapsedMs = totalTicks <= 0
      ? 0
      : durationMs * clamp(Number(tick || 0) / totalTicks, 0, 1);

    els.tickLabel.textContent = `${formatMatchTime(elapsedMs)} / ${formatMatchTime(durationMs)}`;
    const progress = totalTicks <= 0 ? 0 : (Number(tick || 0) / totalTicks) * 100;
    els.progressBar.style.width = `${clamp(progress, 0, 100)}%`;
  }

  function getMatchDurationMs() {
    const explicitDuration = Number(state.info?.durationMs || 0);
    if (explicitDuration > 0) {
      return explicitDuration;
    }

    const totalTicks = Number(state.info?.totalTicks || 64);
    const tickDurationMs = Number(state.info?.tickDurationMs || state.animationDurationMs || 2800);
    return Math.max(1, totalTicks * tickDurationMs);
  }

  function formatMatchTime(ms) {
    const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function updateServerTime(value) {
    if (!value) {
      return;
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      els.serverTimeLabel.textContent = date.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    }
  }

  function updateMatchStatus() {
    const status = getStatusCode();
    if (status === "finished") {
      setStatus("МАТЧ ОКОНЧЕН");
      return;
    }

    if (status !== "waiting" || !state.info?.startedAt) {
      return;
    }

    const startedAtMs = Date.parse(state.info.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return;
    }

    const remainingMs = startedAtMs - Date.now();
    if (remainingMs <= 0) {
      setStatus("Идет матч");
      return;
    }

    setStatus(`Матч начнется через ${formatCountdown(remainingMs)}`);
  }

  function setStatus(text) {
    els.matchStatus.textContent = text;
  }

  function setPhase(status) {
    const label = {
      waiting: "Ожидание",
      running: "Идет матч",
      finished: "МАТЧ ОКОНЧЕН",
      expired: "Истек"
    }[status] || status || "Ожидание";

    els.phaseLabel.textContent = label;
  }

  function getStatusCode() {
    return state.targetFrame?.status || state.info?.status || "";
  }

  function readWebSocketSource(params) {
    if (params.has("w")) {
      return {
        value: sanitizeWebSocketUrl(decodeBase64Url(params.get("w") || "")),
        shouldClean: true
      };
    }

    const key = params.has("ws") ? "ws" : params.has("socket") ? "socket" : null;
    if (!key) {
      return { value: "", shouldClean: false };
    }

    return {
      value: sanitizeWebSocketUrl(params.get(key) || ""),
      shouldClean: true
    };
  }

  function buildWebSocketUrl(value, matchId) {
    if (!value || !matchId) {
      return null;
    }

    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }

    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return null;
    }

    if (url.pathname.includes("/ws/matches/") || url.pathname.includes("/matches/")) {
      url.searchParams.delete("token");
      return url.toString();
    }

    const base = value.replace(/\/+$/, "");
    const path = new URL(base).pathname.replace(/\/+$/, "");
    const matchPath = path.endsWith("/ws")
      ? `/matches/${encodeURIComponent(matchId)}`
      : `/ws/matches/${encodeURIComponent(matchId)}`;

    return `${base}${matchPath}`;
  }

  function buildSnapshotUrl(webSocketUrl) {
    try {
      const url = new URL(webSocketUrl);
      if (url.protocol === "ws:") {
        url.protocol = "http:";
      } else if (url.protocol === "wss:") {
        url.protocol = "https:";
      } else {
        return null;
      }

      url.pathname = url.pathname.replace(/\/ws\/matches\//i, "/matches/");
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return null;
    }
  }

  function deriveDefaultWebSocketBase() {
    const host = window.location.host;
    if (!host || window.location.hostname.endsWith("github.io")) {
      return "";
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${host}`;
  }

  function decodeBase64Url(value) {
    if (!value) {
      return "";
    }

    try {
      let base64 = value.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) {
        base64 += "=";
      }

      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }

  function normalizeWebSocketBase(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value);
      if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        return "";
      }

      url.pathname = url.pathname
        .replace(/\/(?:ws\/)?matches\/[^/]+\/?$/i, "")
        .replace(/\/+$/, "");
      url.search = "";
      url.hash = "";

      return url.toString().replace(/\/+$/, "");
    } catch {
      return "";
    }
  }

  function sanitizeWebSocketUrl(value) {
    if (!value) {
      return "";
    }

    try {
      const url = new URL(value);
      url.searchParams.delete("token");
      return url.toString();
    } catch {
      return value;
    }
  }

  function replaceCurrentQuery(params) {
    if (!window.history?.replaceState) {
      return;
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.search = params.toString();
    window.history.replaceState(null, "", cleanUrl.toString());
  }

  function setCustomFieldImage(value) {
    if (!value) {
      return;
    }

    els.pitch.style.setProperty("--field-image", `url("${cssString(value)}")`);
    els.pitch.classList.add("customField");
  }

  function cellToPercent(lane, column) {
    return {
      x: ((clamp(column, 0, field.columns - 1) + 0.5) / field.columns) * 100,
      y: ((clamp(lane, 0, field.lanes - 1) + 0.5) / field.lanes) * 100
    };
  }

  function teamColor(team) {
    return team === "blue" ? "#3887e8" : "#d94747";
  }

  function heroImage(hero) {
    return `../images/${encodeURIComponent(String(hero || "shaman").toLowerCase())}.png`;
  }

  function cssString(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function normalizeId(value) {
    if (value === null || value === undefined) {
      return null;
    }

    return typeof value === "number" ? value : String(value);
  }

  function findPlayer(players, id) {
    if (id === null || id === undefined) {
      return null;
    }

    return players.find((player) => String(player.id) === String(id)) || null;
  }

  function trimSet(set, maxSize) {
    while (set.size > maxSize) {
      set.delete(set.values().next().value);
    }
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();

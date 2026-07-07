(function () {
  const field = { lanes: 3, columns: 7 };
  const maxEvents = 90;
  const reconnectDelayMs = 2500;

  const els = {
    matchStatus: document.getElementById("matchStatus"),
    redScore: document.getElementById("redScore"),
    blueScore: document.getElementById("blueScore"),
    tickLabel: document.getElementById("tickLabel"),
    progressBar: document.getElementById("progressBar"),
    matchIdInput: document.getElementById("matchIdInput"),
    tokenInput: document.getElementById("tokenInput"),
    wsInput: document.getElementById("wsInput"),
    connectButton: document.getElementById("connectButton"),
    phaseLabel: document.getElementById("phaseLabel"),
    matchIdLabel: document.getElementById("matchIdLabel"),
    serverTimeLabel: document.getElementById("serverTimeLabel"),
    pitch: document.getElementById("pitch"),
    playersLayer: document.getElementById("playersLayer"),
    objectsLayer: document.getElementById("objectsLayer"),
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
    playerEls: new Map(),
    objectEls: new Map(),
    events: []
  };

  init();
  requestAnimationFrame(render);

  function init() {
    const params = new URLSearchParams(window.location.search);
    els.matchIdInput.value = params.get("id") || "";
    els.tokenInput.value = params.get("token") || "";
    setCustomFieldImage(params.get("field"));

    const wsParam = params.get("ws") || params.get("socket") || "";
    els.wsInput.value =
      wsParam ||
      localStorage.getItem("bamjoballLiveWs") ||
      deriveDefaultWebSocketBase() ||
      "";

    els.connectButton.addEventListener("click", connectFromInputs);

    if (els.matchIdInput.value && els.tokenInput.value && els.wsInput.value) {
      connectFromInputs();
    } else if (els.matchIdInput.value && els.tokenInput.value) {
      setStatus("Нужен WebSocket URL");
    }
  }

  function connectFromInputs() {
    const matchId = els.matchIdInput.value.trim();
    const token = els.tokenInput.value.trim();
    const wsValue = els.wsInput.value.trim();
    const url = buildWebSocketUrl(wsValue, matchId, token);

    if (!matchId || !token || !url) {
      setStatus("Не заполнено подключение");
      return;
    }

    localStorage.setItem("bamjoballLiveWs", wsValue);
    openSocket(url);
  }

  function openSocket(url) {
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
      els.connectButton.disabled = false;
      if (!state.shouldReconnect || getStatusCode() === "finished") {
        setStatus(getStatusCode() === "finished" ? "Матч завершен" : "Отключено");
        return;
      }

      setStatus("Переподключение");
      state.reconnectTimer = setTimeout(() => openSocket(url), reconnectDelayMs);
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

  function handleServerMessage(message) {
    switch (message.type) {
      case "hello":
        updateServerTime(message.serverTime);
        break;

      case "match_info":
        state.info = message;
        field.lanes = message.field?.lanes || field.lanes;
        field.columns = message.field?.columns || field.columns;
        state.animationDurationMs = clamp(message.tickDurationMs || 2800, 350, 10000);
        els.matchIdLabel.textContent = message.matchId || "-";
        setPhase(message.status);
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
        setStatus("Матч завершен");
        state.shouldReconnect = false;
        updateScore(message.score);
        break;

      case "pong":
        updateServerTime(message.serverTime);
        break;

      case "error":
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
        : clamp(state.info?.tickDurationMs || state.animationDurationMs, 350, 10000);

    updateScore(frame.score);
    updateTick(frame.tick);
    updateRosters(frame.players);

    const visibleEvents = frame.events.filter((event) => event.visible !== false);
    for (const event of visibleEvents) {
      pushEvent(event);
    }
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
        lastTouchPlayerId: normalizeId(message.ball?.lastTouchPlayerId)
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
        visible: event.visible !== false
      }))
    };
  }

  function render(now) {
    const frame = getInterpolatedFrame(now);
    if (frame) {
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
    const eased = easeInOut(t);
    const previousPlayers = new Map(state.previousFrame.players.map((player) => [String(player.id), player]));
    const players = state.targetFrame.players.map((player) => {
      const previous = previousPlayers.get(String(player.id)) || player;
      return {
        ...player,
        lane: lerp(previous.lane, player.lane, eased),
        column: lerp(previous.column, player.column, eased)
      };
    });

    return {
      ...state.targetFrame,
      players,
      ball: interpolateBall(state.previousFrame, state.targetFrame, eased)
    };
  }

  function interpolateBall(previousFrame, targetFrame, t) {
    const previousBall = previousFrame.ball || targetFrame.ball;
    return {
      ...targetFrame.ball,
      lane: lerp(previousBall.lane, targetFrame.ball.lane, t),
      column: lerp(previousBall.column, targetFrame.ball.column, t)
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
      el.style.left = `${position.x}%`;
      el.style.top = `${position.y}%`;
      el.style.setProperty("--team-color", teamColor(player.team));
      el.classList.toggle("hasBall", player.hasBall);
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

  function updateScore(score) {
    if (!score) {
      return;
    }

    els.redScore.textContent = String(score.red ?? 0);
    els.blueScore.textContent = String(score.blue ?? 0);
  }

  function updateTick(tick) {
    const total = state.info?.totalTicks || 64;
    els.tickLabel.textContent = `${tick} / ${total}`;
    els.progressBar.style.width = `${clamp((tick / total) * 100, 0, 100)}%`;
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

  function setStatus(text) {
    els.matchStatus.textContent = text;
  }

  function setPhase(status) {
    const label = {
      waiting: "Ожидание",
      running: "Идет матч",
      finished: "Завершен",
      expired: "Истек"
    }[status] || status || "Ожидание";

    els.phaseLabel.textContent = label;
  }

  function getStatusCode() {
    return state.targetFrame?.status || state.info?.status || "";
  }

  function buildWebSocketUrl(value, matchId, token) {
    if (!value || !matchId || !token) {
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
      if (!url.searchParams.has("token")) {
        url.searchParams.set("token", token);
      }
      return url.toString();
    }

    const base = value.replace(/\/+$/, "");
    const path = new URL(base).pathname.replace(/\/+$/, "");
    const matchPath = path.endsWith("/ws")
      ? `/matches/${encodeURIComponent(matchId)}`
      : `/ws/matches/${encodeURIComponent(matchId)}`;

    return `${base}${matchPath}?token=${encodeURIComponent(token)}`;
  }

  function deriveDefaultWebSocketBase() {
    const host = window.location.host;
    if (!host || window.location.hostname.endsWith("github.io")) {
      return "";
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${host}`;
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

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
})();

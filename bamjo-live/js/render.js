import { els, state, tickAnimationStretch } from "./state.js";
import { projectBallPhysics } from "./ballPhysics.js";
import {
  cellToPercent,
  clamp,
  cssString,
  findPlayer,
  formatCountdown,
  formatMatchTime,
  heroImage,
  lerp,
  teamColor
} from "./utils.js";

export function renderFrame(now) {
  updateMatchStatus();
  const frame = getInterpolatedFrame(now);
  if (frame) {
    updateTick(frame.visualTick ?? frame.tick);
    renderPlayers(frame);
    renderObjects(frame);
    renderBall(frame);
  }
}

export function getInterpolatedFrame(now) {
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
    ball: interpolateBall(state.previousFrame, state.targetFrame, players, t, now)
  };
}

export function getTickAnimationDuration() {
  return clamp(
    (state.info?.tickDurationMs || state.animationDurationMs || 2800) * tickAnimationStretch,
    450,
    12000
  );
}

export function updateRosters(players) {
  els.redRoster.replaceChildren(...players.filter((player) => player.team === "red").map(createRosterCard));
  els.blueRoster.replaceChildren(...players.filter((player) => player.team === "blue").map(createRosterCard));
}

export function updateScore(score) {
  if (!score) {
    return;
  }

  els.redScore.textContent = String(score.red ?? 0);
  els.blueScore.textContent = String(score.blue ?? 0);
}

export function updateTick(tick) {
  const totalTicks = state.info?.totalTicks || 64;
  const durationMs = getMatchDurationMs();
  const elapsedMs = totalTicks <= 0
    ? 0
    : durationMs * clamp(Number(tick || 0) / totalTicks, 0, 1);

  els.tickLabel.textContent = `${formatMatchTime(elapsedMs)} / ${formatMatchTime(durationMs)}`;
  const progress = totalTicks <= 0 ? 0 : (Number(tick || 0) / totalTicks) * 100;
  els.progressBar.style.width = `${clamp(progress, 0, 100)}%`;
}

export function updateServerTime(value) {
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

export function updateMatchStatus() {
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

export function setStatus(text) {
  els.matchStatus.textContent = text;
}

export function setPhase(status) {
  const label = {
    waiting: "Ожидание",
    running: "Идет матч",
    finished: "МАТЧ ОКОНЧЕН",
    expired: "Истек"
  }[status] || status || "Ожидание";

  els.phaseLabel.textContent = label;
}

export function getStatusCode() {
  return state.targetFrame?.status || state.info?.status || "";
}

export function setCustomFieldImage(value) {
  if (!value) {
    return;
  }

  els.pitch.style.setProperty("--field-image", `url("${cssString(value)}")`);
  els.pitch.classList.add("customField");
}

function interpolateBall(previousFrame, targetFrame, visualPlayers, t, now) {
  const physicsBall = projectBallPhysics(targetFrame, visualPlayers, now);
  if (physicsBall) {
    return physicsBall;
  }

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

  return {
    ...targetFrame.ball,
    holderPlayerId: catching ? null : targetFrame.ball.holderPlayerId,
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

function getMatchDurationMs() {
  const explicitDuration = Number(state.info?.durationMs || 0);
  if (explicitDuration > 0) {
    return explicitDuration;
  }

  const totalTicks = Number(state.info?.totalTicks || 64);
  const tickDurationMs = Number(state.info?.tickDurationMs || state.animationDurationMs || 2800);
  return Math.max(1, totalTicks * tickDurationMs);
}

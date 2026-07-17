import { els, field, maxEvents, state } from "./state.js?v=0.5.11";
import { cellToPercent, formatMatchTime, teamColor, trimSet } from "./utils.js?v=0.5.11";

export function queueFrameEvents(frame, sourceType) {
  for (const event of frame.events) {
    const delay = eventDelayMs(event, sourceType, frame);
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

export function queueTimelineEvents(events) {
  for (const event of events || []) {
    const key = eventKey(event);
    if (state.timelineEventKeys.has(key) || state.eventKeys.has(key)) {
      continue;
    }

    state.timelineEventKeys.add(key);
    state.timelineEvents.push(event);
    rememberGoalEvent(event, key);
  }

  state.timelineEvents.sort((left, right) => eventTime(left) - eventTime(right));
  trimSet(state.timelineEventKeys, 300);
}

function rememberGoalEvent(event, key) {
  if (event.kind !== "goal" || state.goalEventKeys.has(key)) {
    return;
  }

  state.goalEventKeys.add(key);
  state.goalEvents.push(event);
  state.goalEvents.sort((left, right) => eventTime(left) - eventTime(right));
  if (state.goalEvents.length > 24) {
    state.goalEvents.splice(0, state.goalEvents.length - 24);
  }
  trimSet(state.goalEventKeys, 64);
}

export function flushTimelineEvents(playbackTimeMs, frame) {
  const due = [];
  const future = [];

  for (const event of state.timelineEvents) {
    if (eventTime(event) <= playbackTimeMs) {
      due.push(event);
    } else {
      future.push(event);
    }
  }

  state.timelineEvents = future;
  for (const event of due) {
    if (shouldSpawnEffect(event)) {
      spawnEffectOnce(event, frame || fallbackFrame());
    }
    if (event.visible !== false) {
      pushEvent(event);
    }
  }
}

export function pushEvent(event) {
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

export function hasTag(event, tag) {
  return (event.tags || []).some((value) => value.toLowerCase() === tag);
}

function eventDelayMs(event, sourceType, frame) {
  if (sourceType === "snapshot") {
    return 0;
  }

  if (Number.isFinite(event.offset)) {
    return Math.round(state.animationDurationMs * Math.max(0, Math.min(1, event.offset)));
  }

  if (event.kind === "kickoff" && frame.events.some((item) => item.kind === "goal")) {
    return Math.round(state.animationDurationMs * 0.94);
  }

  if (isResolutionEvent(event)) {
    return Math.round(state.animationDurationMs * 0.82);
  }

  return 0;
}

function isResolutionEvent(event) {
  if (event.kind === "pass" && hasTag(event, "pass_completed")) {
    return true;
  }

  return event.kind === "interception" ||
    event.kind === "tackle" ||
    event.kind === "save" ||
    event.kind === "goal" ||
    event.kind === "loose_ball";
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
  return String(event.hero || "").toLowerCase() === "gohor" &&
    hasTag(event, "gohor_projectile");
}

function spawnEffect(event, frame) {
  if (!els.effectsLayer) {
    return;
  }

  if (String(event.hero || "").toLowerCase() === "gohor" &&
      hasTag(event, "gohor_projectile")) {
    spawnGohorProjectile(event, frame);
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

function spawnGohorProjectile(event, frame) {
  const start = actorPoint(event, frame);
  const end = effectPoint(event, frame);
  const from = cellToPercent(start.lane, start.column);
  const to = cellToPercent(end.lane, end.column);
  const distance = Math.hypot(end.lane - start.lane, end.column - start.column);
  const durationMs = Math.round(Math.max(280, Math.min(900, distance / 58 * 1000)));
  const el = document.createElement("div");
  el.className = `gohorProjectile ${hasTag(event, "speed") ? "speed" : "slow"}`;
  el.style.setProperty("--from-x", `${from.x}%`);
  el.style.setProperty("--from-y", `${from.y}%`);
  el.style.setProperty("--to-x", `${to.x}%`);
  el.style.setProperty("--to-y", `${to.y}%`);
  el.style.setProperty("--flight-duration", `${durationMs}ms`);
  els.effectsLayer.appendChild(el);
  setTimeout(() => el.remove(), durationMs + 80);
}

function actorPoint(event, frame) {
  if (event.actorLane !== null && event.actorLane !== undefined &&
      event.actorColumn !== null && event.actorColumn !== undefined &&
      Number.isFinite(Number(event.actorLane)) &&
      Number.isFinite(Number(event.actorColumn))) {
    return {
      lane: Number(event.actorLane),
      column: Number(event.actorColumn)
    };
  }

  const actor = frame.players.find((player) =>
    event.actorId !== null && event.actorId !== undefined
      ? String(player.id) === String(event.actorId)
      : event.actor && player.nickname === event.actor);
  return actor
    ? { lane: actor.lane, column: actor.column }
    : effectPoint(event, frame);
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

function createEventElement(event) {
  const el = document.createElement("div");
  el.className = "event";
  el.style.setProperty("--team-color", event.team ? teamColor(event.team) : "var(--gold)");

  const meta = document.createElement("div");
  meta.className = "eventMeta";
  const eventTime = Number.isFinite(event.timeMs) ? formatMatchTime(event.timeMs) : event.tick;
  meta.textContent = `${eventTime} · ${event.kind}${event.hero ? ` · ${event.hero}` : ""}`;

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

function eventTime(event) {
  const time = Number(event.timeMs);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function fallbackFrame() {
  return {
    players: [],
    ball: {
      lane: field.lanes / 2,
      column: field.columns / 2
    }
  };
}

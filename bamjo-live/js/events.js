import { els, field, maxEvents, state } from "./state.js?v=0.5.12";
import { cellToPercent, formatMatchTime, teamColor, trimSet } from "./utils.js?v=0.5.12";

const eventScrollBottomTolerance = 24;
const pausedEventLimit = maxEvents * 8;
let followLatestEvent = true;
let selectedEventKey = null;

els.events.addEventListener("scroll", handleEventScroll, { passive: true });
els.events.addEventListener("click", handleEventClick);

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

  resetEventViewStateIfEmpty();

  const key = eventKey(event);
  if (state.eventKeys.has(key)) {
    return;
  }

  state.eventKeys.add(key);
  trimSet(state.eventKeys, pausedEventLimit * 4);

  if (isRepeatedDribble(event)) {
    return;
  }

  state.events.push(event);
  const element = createEventElement(event, key);
  els.events.appendChild(element);

  trimEventLog(followLatestEvent ? maxEvents : pausedEventLimit);
  if (followLatestEvent) {
    scrollEventLogToBottom();
  }
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
  const hero = String(event.hero || "").toLowerCase();
  return (hero === "gohor" && hasTag(event, "gohor_projectile")) ||
    (hero === "warden" && hasTag(event, "warden_power"));
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

  if (String(event.hero || "").toLowerCase() === "warden" &&
      hasTag(event, "warden_power")) {
    spawnWardenEffect(event, frame);
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

function spawnWardenEffect(event, frame) {
  const point = hasTag(event, "knockback")
    ? effectPoint(event, frame)
    : actorPoint(event, frame);
  const position = cellToPercent(point.lane, point.column);
  const phase = hasTag(event, "charge")
    ? "charge"
    : hasTag(event, "knockback")
      ? "impact"
      : "release";
  const durationMs = phase === "charge" ? 620 : phase === "impact" ? 720 : 460;
  const el = document.createElement("div");
  el.className = `wardenEffect ${phase}`;
  el.style.left = `${position.x}%`;
  el.style.top = `${position.y}%`;
  el.style.setProperty("--team-color", event.team ? teamColor(event.team) : "#f1f7ff");
  els.effectsLayer.appendChild(el);
  setTimeout(() => el.remove(), durationMs + 80);
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

function createEventElement(event, key) {
  const el = document.createElement("div");
  el.className = "event";
  el.dataset.eventKey = key;
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

function isRepeatedDribble(event) {
  const previous = state.events[state.events.length - 1];
  return previous !== undefined &&
    event.kind === "move" &&
    previous.kind === "move" &&
    hasTag(event, "dribble") &&
    hasTag(previous, "dribble") &&
    String(event.text).trim() === String(previous.text).trim();
}

function handleEventScroll() {
  const atBottom = isEventLogAtBottom();
  if (!atBottom) {
    followLatestEvent = false;
    return;
  }

  if (!followLatestEvent) {
    followLatestEvent = true;
    clearSelectedEvent();
    trimEventLog(maxEvents);
    scrollEventLogToBottom();
  }
}

function handleEventClick(event) {
  const target = event.target instanceof Element
    ? event.target.closest(".event")
    : null;
  if (!target || !els.events.contains(target)) {
    return;
  }

  const key = target.dataset.eventKey || null;
  if (key && key === selectedEventKey) {
    followLatestEvent = true;
    clearSelectedEvent();
    trimEventLog(maxEvents);
    scrollEventLogToBottom();
    return;
  }

  clearSelectedEvent();
  selectedEventKey = key;
  target.classList.add("selected");
  followLatestEvent = false;
}

function clearSelectedEvent() {
  els.events.querySelector(".event.selected")?.classList.remove("selected");
  selectedEventKey = null;
}

function trimEventLog(limit) {
  const removeCount = Math.max(0, state.events.length - limit);
  if (removeCount === 0) {
    return;
  }

  state.events.splice(0, removeCount);
  for (let index = 0; index < removeCount; index++) {
    els.events.firstElementChild?.remove();
  }
}

function isEventLogAtBottom() {
  return els.events.scrollHeight - els.events.clientHeight - els.events.scrollTop <=
    eventScrollBottomTolerance;
}

function scrollEventLogToBottom() {
  els.events.scrollTop = els.events.scrollHeight;
}

function resetEventViewStateIfEmpty() {
  if (state.events.length !== 0 || els.events.childElementCount !== 0) {
    return;
  }

  followLatestEvent = true;
  selectedEventKey = null;
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

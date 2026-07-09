import { els, maxEvents, state } from "./state.js";
import { scheduleAtMatchTime } from "./timeline.js";
import { cellToPercent, formatMatchTime, teamColor, trimSet } from "./utils.js";

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
    scheduleAtMatchTime(event.timeMs, () => {
      const frame = state.targetFrame || fallbackFrame();
      if (shouldSpawnEffect(event)) {
        spawnEffectOnce(event, frame);
      }
      if (event.visible !== false) {
        pushEvent(event);
      }
    });
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

function fallbackFrame() {
  return {
    players: [],
    ball: {
      lane: 1,
      column: 3
    }
  };
}

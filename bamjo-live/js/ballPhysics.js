import { field, state } from "./state.js";
import { clamp, findPlayer, normalizeId, trimSet } from "./utils.js";

const attachTransitionMs = 240;
const stopTransitionMs = 160;

export function queueBallPhysicsEvents(events) {
  for (const event of events || []) {
    const key = physicsEventKey(event);
    if (state.physicsEventKeys.has(key)) {
      continue;
    }

    state.physicsEventKeys.add(key);
    state.physicsEvents.push(normalizePhysicsEvent(event, key));
  }

  state.physicsEvents.sort((left, right) => left.timeMs - right.timeMs);
  trimSet(state.physicsEventKeys, 500);
}

export function resetBallPhysicsFromFrame(frame) {
  if (!frame?.ball) {
    state.ballPhysics = null;
    return;
  }

  state.ballPhysics = {
    mode: frame.ball.holderPlayerId !== null ? "attached" : "stopped",
    holderPlayerId: frame.ball.holderPlayerId,
    lane: frame.ball.lane,
    column: frame.ball.column
  };
}

export function projectBallPhysics(frame, visualPlayers, playbackTimeMs) {
  if (!state.usesTimeline) {
    return projectFallbackState(frame, visualPlayers);
  }

  const eventIndex = findPhysicsEventIndex(playbackTimeMs);
  if (eventIndex < 0) {
    return null;
  }

  const event = state.physicsEvents[eventIndex];
  const previous = eventIndex > 0 ? state.physicsEvents[eventIndex - 1] : null;
  const projected = projectFromEvent(event, previous, visualPlayers, playbackTimeMs);
  if (!projected) {
    return null;
  }

  return {
    ...frame.ball,
    ...projected
  };
}

function projectFallbackState(frame, visualPlayers) {
  const physics = state.ballPhysics;
  if (!physics || !frame?.ball) {
    return null;
  }

  if (physics.mode === "attached") {
    const holder = findPlayer(visualPlayers, physics.holderPlayerId);
    if (!holder) {
      return null;
    }

    return {
      ...frame.ball,
      holderPlayerId: physics.holderPlayerId,
      lane: holder.lane,
      column: holder.column
    };
  }

  return {
    ...frame.ball,
    holderPlayerId: null,
    lane: physics.lane,
    column: physics.column
  };
}

function projectFromEvent(event, previous, visualPlayers, playbackTimeMs) {
  if (event.kind === "ball_impulse") {
    return {
      holderPlayerId: null,
      ...projectImpulse(event, playbackTimeMs)
    };
  }

  if (event.kind === "ball_attach") {
    const holderId = normalizeId(event.playerId ?? event.actorId);
    const holder = findPlayer(visualPlayers, holderId);
    const target = holder
      ? { lane: holder.lane, column: holder.column }
      : { lane: event.lane, column: event.column };
    const elapsed = Math.max(0, playbackTimeMs - event.timeMs);
    if (elapsed >= attachTransitionMs) {
      return {
        holderPlayerId: holderId,
        lane: target.lane,
        column: target.column
      };
    }

    const from = previous
      ? projectFromEvent(previous, null, visualPlayers, event.timeMs)
      : { lane: event.lane, column: event.column };
    const t = clamp(elapsed / attachTransitionMs, 0, 1);

    return {
      holderPlayerId: null,
      lane: from.lane + (target.lane - from.lane) * t,
      column: from.column + (target.column - from.column) * t
    };
  }

  if (event.kind === "ball_stop") {
    const elapsed = Math.max(0, playbackTimeMs - event.timeMs);
    if (previous && elapsed < stopTransitionMs) {
      const from = projectFromEvent(previous, null, visualPlayers, event.timeMs);
      const t = clamp(elapsed / stopTransitionMs, 0, 1);

      return {
        holderPlayerId: null,
        lane: from.lane + (event.lane - from.lane) * t,
        column: from.column + (event.column - from.column) * t
      };
    }

    return {
      holderPlayerId: null,
      lane: event.lane,
      column: event.column
    };
  }

  if (event.kind === "ball_teleport") {
    return {
      holderPlayerId: null,
      lane: event.lane,
      column: event.column
    };
  }

  return null;
}

function projectImpulse(event, playbackTimeMs) {
  const elapsedSeconds = Math.max(0, (playbackTimeMs - event.timeMs) / 1000);
  const speed = Math.hypot(event.velocityLane, event.velocityColumn);
  if (speed <= 0) {
    return {
      lane: clamp(event.lane, 0, field.lanes - 1),
      column: clamp(event.column, 0, field.columns - 1)
    };
  }

  const target = targetPoint(event);
  const stopTime = event.friction > 0 ? speed / event.friction : Number.POSITIVE_INFINITY;
  const t = Math.min(elapsedSeconds, stopTime);
  const distance = event.friction > 0
    ? speed * t - 0.5 * event.friction * t * t
    : speed * t;
  const lane = event.lane + (event.velocityLane / speed) * distance;
  const column = event.column + (event.velocityColumn / speed) * distance;

  if (target) {
    const targetDistance = Math.hypot(target.lane - event.lane, target.column - event.column);
    if (targetDistance > 0 && distance >= targetDistance) {
      return {
        lane: clamp(target.lane, 0, field.lanes - 1),
        column: clamp(target.column, 0, field.columns - 1)
      };
    }
  }

  return {
    lane: clamp(lane, 0, field.lanes - 1),
    column: clamp(column, 0, field.columns - 1)
  };
}

function targetPoint(event) {
  const lane = Number(event.targetLane);
  const column = Number(event.targetColumn);
  if (!Number.isFinite(lane) || !Number.isFinite(column)) {
    return null;
  }

  return { lane, column };
}

function findPhysicsEventIndex(playbackTimeMs) {
  let index = -1;
  for (var i = 0; i < state.physicsEvents.length; i++) {
    if (state.physicsEvents[i].timeMs > playbackTimeMs) {
      break;
    }

    index = i;
  }

  return index;
}

function normalizePhysicsEvent(event, key) {
  return {
    ...event,
    id: key,
    kind: String(event.kind || ""),
    timeMs: finiteNumber(event.timeMs, 0),
    actorId: normalizeId(event.actorId),
    playerId: normalizeId(event.playerId),
    lane: finiteNumber(event.lane, 1),
    column: finiteNumber(event.column, 3),
    targetLane: finiteOptionalNumber(event.targetLane),
    targetColumn: finiteOptionalNumber(event.targetColumn),
    velocityLane: finiteNumber(event.velocityLane, 0),
    velocityColumn: finiteNumber(event.velocityColumn, 0),
    friction: Math.max(0, finiteNumber(event.friction, 0))
  };
}

function physicsEventKey(event) {
  return event.id || [
    event.timeMs ?? "-",
    event.kind || "-",
    event.source || "-",
    event.actor || "-",
    event.playerId ?? event.actorId ?? "-"
  ].join("|");
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

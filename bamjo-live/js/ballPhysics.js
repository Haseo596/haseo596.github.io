import { field, state } from "./state.js?v=0.5.12";
import { clamp, findPlayer, normalizeId, trimSet } from "./utils.js?v=0.5.12";

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
    timeline: false,
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

  const projectedTimeline = projectTimelineState(frame, visualPlayers, playbackTimeMs);
  if (projectedTimeline) {
    return projectedTimeline;
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

function projectTimelineState(frame, visualPlayers, playbackTimeMs) {
  if (!frame?.ball || !Number.isFinite(playbackTimeMs)) {
    return null;
  }

  let physics = state.ballPhysics;
  if (!physics || physics.timeline !== true || playbackTimeMs < physics.playbackTimeMs - 120) {
    physics = initializeTimelineState(frame, visualPlayers, playbackTimeMs);
    state.ballPhysics = physics;
  }

  const fromMs = physics.playbackTimeMs;
  const dueEvents = state.physicsEvents.filter((event) =>
    event.timeMs > fromMs &&
    event.timeMs <= playbackTimeMs);

  for (const event of dueEvents) {
    integrateTimelineState(physics, visualPlayers, event.timeMs);
    applyTimelineEvent(physics, event);
  }

  integrateTimelineState(physics, visualPlayers, playbackTimeMs);

  return {
    ...frame.ball,
    holderPlayerId: physics.holderPlayerId ?? null,
    lane: physics.lane,
    column: physics.column
  };
}

function initializeTimelineState(frame, visualPlayers, playbackTimeMs) {
  const eventIndex = findPhysicsEventIndex(playbackTimeMs);
  const event = eventIndex >= 0 ? state.physicsEvents[eventIndex] : null;
  const previous = eventIndex > 0 ? state.physicsEvents[eventIndex - 1] : null;
  const projected = event
    ? projectFromEvent(event, previous, visualPlayers, playbackTimeMs)
    : null;
  const ball = projected || frame.ball;

  const state = {
    timeline: true,
    mode: ball.holderPlayerId !== null && ball.holderPlayerId !== undefined ? "attached" : "stopped",
    playbackTimeMs,
    holderPlayerId: ball.holderPlayerId ?? null,
    lane: finiteNumber(ball.lane, frame.ball.lane),
    column: finiteNumber(ball.column, frame.ball.column),
    velocityLane: 0,
    velocityColumn: 0,
    friction: 0,
    attachStartedAtMs: playbackTimeMs,
    attachFromLane: finiteNumber(ball.lane, frame.ball.lane),
    attachFromColumn: finiteNumber(ball.column, frame.ball.column),
    stopStartedAtMs: playbackTimeMs,
    stopFromLane: finiteNumber(ball.lane, frame.ball.lane),
    stopFromColumn: finiteNumber(ball.column, frame.ball.column),
    stopTargetLane: finiteNumber(ball.lane, frame.ball.lane),
    stopTargetColumn: finiteNumber(ball.column, frame.ball.column)
  };

  if (event?.kind === "ball_impulse") {
    const friction = Math.max(0, event.friction * 0.35);
    const elapsedSeconds = Math.max(0, (playbackTimeMs - event.timeMs) / 1000);
    const speed = Math.hypot(event.velocityLane, event.velocityColumn);
    const nextSpeed = friction > 0
      ? Math.max(0, speed - friction * elapsedSeconds)
      : speed;

    if (nextSpeed > 0.01 && speed > 0) {
      state.mode = "impulse";
      state.holderPlayerId = null;
      state.velocityLane = (event.velocityLane / speed) * nextSpeed;
      state.velocityColumn = (event.velocityColumn / speed) * nextSpeed;
      state.friction = friction;
    }
  }

  return state;
}

function integrateTimelineState(physics, visualPlayers, toMs) {
  const elapsedMs = Math.max(0, toMs - physics.playbackTimeMs);

  if (physics.mode === "attached") {
    const holder = findPlayer(visualPlayers, physics.holderPlayerId);
    if (holder) {
      physics.lane = holder.lane;
      physics.column = holder.column;
    }
  } else if (physics.mode === "attaching") {
    const holder = findPlayer(visualPlayers, physics.holderPlayerId);
    const target = holder
      ? { lane: holder.lane, column: holder.column }
      : { lane: physics.lane, column: physics.column };
    const t = clamp((toMs - physics.attachStartedAtMs) / attachTransitionMs, 0, 1);
    physics.lane = lerpNumber(physics.attachFromLane, target.lane, t);
    physics.column = lerpNumber(physics.attachFromColumn, target.column, t);
    if (t >= 1) {
      physics.mode = "attached";
    }
  } else if (physics.mode === "stopping") {
    const t = clamp((toMs - physics.stopStartedAtMs) / stopTransitionMs, 0, 1);
    physics.lane = lerpNumber(physics.stopFromLane, physics.stopTargetLane, t);
    physics.column = lerpNumber(physics.stopFromColumn, physics.stopTargetColumn, t);
    if (t >= 1) {
      physics.mode = "stopped";
    }
  } else if (physics.mode === "impulse" && elapsedMs > 0) {
    const elapsedSeconds = elapsedMs / 1000;
    const speed = Math.hypot(physics.velocityLane, physics.velocityColumn);
    if (speed > 0) {
      const friction = Math.max(0, physics.friction || 0);
      const distance = friction > 0
        ? Math.max(0, speed * elapsedSeconds - 0.5 * friction * elapsedSeconds * elapsedSeconds)
        : speed * elapsedSeconds;
      const directionLane = physics.velocityLane / speed;
      const directionColumn = physics.velocityColumn / speed;

      physics.lane += directionLane * distance;
      physics.column += directionColumn * distance;

      const nextSpeed = friction > 0
        ? Math.max(0, speed - friction * elapsedSeconds)
        : speed;
      physics.velocityLane = directionLane * nextSpeed;
      physics.velocityColumn = directionColumn * nextSpeed;
      if (nextSpeed <= 0.01) {
        physics.mode = "stopped";
      }
    }
  }

  physics.lane = clamp(
    physics.lane,
    fieldMinimum("lane") - 0.48,
    fieldMaximum("lane") + 0.48
  );
  physics.column = clamp(
    physics.column,
    fieldMinimum("column") - 0.48,
    fieldMaximum("column") + 0.48
  );
  physics.playbackTimeMs = toMs;
}

function applyTimelineEvent(physics, event) {
  if (event.kind === "ball_impulse") {
    physics.mode = "impulse";
    physics.holderPlayerId = null;
    physics.velocityLane = event.velocityLane;
    physics.velocityColumn = event.velocityColumn;
    physics.friction = event.friction * 0.35;
    return;
  }

  if (event.kind === "ball_attach") {
    physics.mode = "attaching";
    physics.holderPlayerId = normalizeId(event.playerId ?? event.actorId);
    physics.attachStartedAtMs = event.timeMs;
    physics.attachFromLane = physics.lane;
    physics.attachFromColumn = physics.column;
    physics.velocityLane = 0;
    physics.velocityColumn = 0;
    physics.friction = 0;
    return;
  }

  if (event.kind === "ball_stop") {
    physics.mode = "stopping";
    physics.holderPlayerId = null;
    physics.stopStartedAtMs = event.timeMs;
    physics.stopFromLane = physics.lane;
    physics.stopFromColumn = physics.column;
    physics.stopTargetLane = event.lane;
    physics.stopTargetColumn = event.column;
    physics.velocityLane = 0;
    physics.velocityColumn = 0;
    physics.friction = 0;
    return;
  }

  if (event.kind === "ball_teleport") {
    physics.mode = "stopped";
    physics.holderPlayerId = null;
    physics.lane = event.lane;
    physics.column = event.column;
    physics.velocityLane = 0;
    physics.velocityColumn = 0;
    physics.friction = 0;
  }
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
      lane: clamp(event.lane, fieldMinimum("lane"), fieldMaximum("lane")),
      column: clamp(
        event.column,
        fieldMinimum("column"),
        fieldMaximum("column")
      )
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
        lane: clamp(target.lane, fieldMinimum("lane"), fieldMaximum("lane")),
        column: clamp(
          target.column,
          fieldMinimum("column"),
          fieldMaximum("column")
        )
      };
    }
  }

  return {
    lane: clamp(lane, fieldMinimum("lane"), fieldMaximum("lane")),
    column: clamp(column, fieldMinimum("column"), fieldMaximum("column"))
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
    lane: finiteNumber(event.lane, field.lanes / 2),
    column: finiteNumber(event.column, field.columns / 2),
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

function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

function finiteOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function fieldMaximum(axis) {
  const size = axis === "lane" ? field.lanes : field.columns;
  if (field.coordinateMode !== "continuous") {
    return size - 1;
  }

  return axis === "column" ? size + Number(field.goalDepth || 0) : size;
}

function fieldMinimum(axis) {
  if (field.coordinateMode !== "continuous" || axis !== "column") {
    return 0;
  }

  return -Number(field.goalDepth || 0);
}

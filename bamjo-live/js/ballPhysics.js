import { field, state } from "./state.js";
import { scheduleAtMatchTime } from "./timeline.js";
import { clamp, findPlayer, normalizeId } from "./utils.js";

export function queueBallPhysicsEvents(events) {
  for (const event of events || []) {
    const key = physicsEventKey(event);
    if (state.physicsEventKeys.has(key)) {
      continue;
    }

    state.physicsEventKeys.add(key);
    scheduleAtMatchTime(event.timeMs, () => applyBallPhysicsEvent(event));
  }
}

export function resetBallPhysicsFromFrame(frame) {
  if (!frame?.ball) {
    state.ballPhysics = null;
    return;
  }

  if (frame.ball.holderPlayerId !== null) {
    state.ballPhysics = {
      mode: "attached",
      holderPlayerId: frame.ball.holderPlayerId,
      lane: frame.ball.lane,
      column: frame.ball.column
    };
    return;
  }

  state.ballPhysics = {
    mode: "stopped",
    holderPlayerId: null,
    lane: frame.ball.lane,
    column: frame.ball.column
  };
}

export function projectBallPhysics(frame, visualPlayers, now) {
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

  if (physics.mode === "free") {
    return {
      ...frame.ball,
      holderPlayerId: null,
      ...projectFreeBall(physics, now)
    };
  }

  return {
    ...frame.ball,
    holderPlayerId: null,
    lane: physics.lane,
    column: physics.column
  };
}

function applyBallPhysicsEvent(event) {
  const kind = String(event.kind || "");

  if (kind === "ball_impulse") {
    state.ballPhysics = {
      mode: "free",
      holderPlayerId: null,
      startedAt: performance.now(),
      lane: finiteNumber(event.lane, 1),
      column: finiteNumber(event.column, 3),
      velocityLane: finiteNumber(event.velocityLane, 0),
      velocityColumn: finiteNumber(event.velocityColumn, 0),
      friction: Math.max(0, finiteNumber(event.friction, 0))
    };
    return;
  }

  if (kind === "ball_attach") {
    state.ballPhysics = {
      mode: "attached",
      holderPlayerId: normalizeId(event.playerId ?? event.actorId),
      lane: finiteNumber(event.lane, 1),
      column: finiteNumber(event.column, 3)
    };
    return;
  }

  if (kind === "ball_stop" || kind === "ball_teleport") {
    state.ballPhysics = {
      mode: "stopped",
      holderPlayerId: null,
      lane: finiteNumber(event.lane, 1),
      column: finiteNumber(event.column, 3)
    };
  }
}

function projectFreeBall(physics, now) {
  const elapsedSeconds = Math.max(0, (now - physics.startedAt) / 1000);
  const speed = Math.hypot(physics.velocityLane, physics.velocityColumn);
  if (speed <= 0) {
    return {
      lane: clamp(physics.lane, 0, field.lanes - 1),
      column: clamp(physics.column, 0, field.columns - 1)
    };
  }

  const stopTime = physics.friction > 0 ? speed / physics.friction : Number.POSITIVE_INFINITY;
  const t = Math.min(elapsedSeconds, stopTime);
  const distance = physics.friction > 0
    ? speed * t - 0.5 * physics.friction * t * t
    : speed * t;

  return {
    lane: clamp(physics.lane + (physics.velocityLane / speed) * distance, 0, field.lanes - 1),
    column: clamp(physics.column + (physics.velocityColumn / speed) * distance, 0, field.columns - 1)
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

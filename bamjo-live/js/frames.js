import { normalizeId } from "./utils.js?v=0.5.12";
import { field } from "./state.js?v=0.5.12";

export function normalizeFrame(message) {
  const legacyGrid = usesLegacyGridCoordinates(message);
  return {
    key: message.key || null,
    tick: Number(message.tick || 0),
    timeMs: finiteNumberOrNull(message.timeMs),
    status: message.status || "running",
    score: {
      red: Number(message.score?.red || 0),
      blue: Number(message.score?.blue || 0)
    },
    ball: {
      lane: normalizeCoordinate(readCoordinate(message.ball, "lane"), "lane", legacyGrid),
      column: normalizeCoordinate(readCoordinate(message.ball, "column"), "column", legacyGrid),
      z: Math.max(0, finiteNumberOrNull(
        message.ball?.z ?? message.ball?.height ?? message.ball?.Height
      ) ?? 0),
      verticalVelocityZ: finiteNumberOrNull(
        message.ball?.verticalVelocityZ ??
        message.ball?.verticalVelocity ??
        message.ball?.VerticalVelocity
      ) ?? 0,
      holderPlayerId: normalizeId(message.ball?.holderPlayerId),
      lastTouchPlayerId: normalizeId(message.ball?.lastTouchPlayerId),
      power: Number(message.ball?.power || 0),
      powerShot: Boolean(message.ball?.powerShot),
      remainingSteps: Number(message.ball?.remainingSteps || 0),
      laneVelocity: Number(message.ball?.laneVelocity || 0),
      columnVelocity: Number(message.ball?.columnVelocity || 0),
      targetLane: normalizeNullableCoordinate(
        finiteNumberOrNull(message.ball?.targetLane ?? message.ball?.TargetLane),
        "lane",
        legacyGrid
      ),
      targetColumn: normalizeNullableCoordinate(
        finiteNumberOrNull(message.ball?.targetColumn ?? message.ball?.TargetColumn),
        "column",
        legacyGrid
      )
    },
    players: (message.players || []).map((player) => ({
      id: normalizeId(player.id),
      nickname: String(player.nickname || player.id || "-"),
      team: player.team === "blue" ? "blue" : "red",
      hero: String(player.hero || "shaman"),
      role: String(player.role || "-"),
      cardId: player.cardId || null,
      lane: normalizeCoordinate(readCoordinate(player, "lane"), "lane", legacyGrid),
      column: normalizeCoordinate(readCoordinate(player, "column"), "column", legacyGrid),
      targetLane: normalizeNullableCoordinate(
        finiteNumberOrNull(player.targetLane ?? player.TargetLane),
        "lane",
        legacyGrid
      ),
      targetColumn: normalizeNullableCoordinate(
        finiteNumberOrNull(player.targetColumn ?? player.TargetColumn),
        "column",
        legacyGrid
      ),
      velocityLane: Number(player.velocityLane ?? player.VelocityLane ?? 0),
      velocityColumn: Number(player.velocityColumn ?? player.VelocityColumn ?? 0),
      facingLane: Number(player.facingLane ?? player.FacingLane ?? 0),
      facingColumn: Number(player.facingColumn ?? player.FacingColumn ?? 0),
      z: Math.max(0, finiteNumberOrNull(
        player.z ?? player.Z ?? player.height ?? player.Height
      ) ?? 0),
      verticalVelocityZ: finiteNumberOrNull(
        player.verticalVelocityZ ?? player.VerticalVelocityZ ?? player.verticalVelocity ?? player.VerticalVelocity
      ) ?? 0,
      mana: Number(player.mana ?? player.Mana ?? 0),
      sprinting: Boolean(player.sprinting ?? player.IsSprinting),
      hasBall: Boolean(player.hasBall)
    })),
    objects: (message.objects || []).map((object) => ({
      id: normalizeId(object.id),
      type: String(object.type || "object"),
      team: object.team === "blue" ? "blue" : "red",
      lane: normalizeCoordinate(readCoordinate(object, "lane"), "lane", legacyGrid),
      column: normalizeCoordinate(readCoordinate(object, "column"), "column", legacyGrid),
      remainingTicks: Number(object.remainingTicks || 0)
    })),
    events: (message.events || []).map((event) => ({
      tick: event.tick ?? message.tick ?? "-",
      kind: String(event.kind || "event"),
      team: event.team || null,
      actor: event.actor || null,
      actorId: normalizeId(event.actorId ?? event.ActorId),
      hero: event.hero || null,
      offset: finiteNumberOrNull(event.offset),
      timeMs: finiteNumberOrNull(event.timeMs),
      text: String(event.text || ""),
      lane: normalizeNullableCoordinate(readCoordinate(event, "lane"), "lane", legacyGrid),
      column: normalizeNullableCoordinate(readCoordinate(event, "column"), "column", legacyGrid),
      actorLane: normalizeNullableCoordinate(
        finiteNumberOrNull(event.actorLane ?? event.ActorLane),
        "lane",
        legacyGrid
      ),
      actorColumn: normalizeNullableCoordinate(
        finiteNumberOrNull(event.actorColumn ?? event.ActorColumn),
        "column",
        legacyGrid
      ),
      ballZ: Math.max(0, finiteNumberOrNull(
        event.ballZ ?? event.BallZ ?? event.ballHeight
      ) ?? 0),
      ballVerticalVelocityZ: finiteNumberOrNull(
        event.ballVerticalVelocityZ ?? event.BallVerticalVelocityZ
      ) ?? 0,
      tags: (event.tags || []).map((tag) => String(tag)),
      visible: event.visible !== false
    }))
  };
}

function usesLegacyGridCoordinates(message) {
  if (field.coordinateMode !== "continuous" || field.lanes <= 3 || field.columns <= 7) {
    return false;
  }

  const points = (message.players || [])
    .map((player) => ({
      lane: readCoordinate(player, "lane"),
      column: readCoordinate(player, "column")
    }))
    .filter((point) => Number.isFinite(point.lane) && Number.isFinite(point.column));

  return points.length >= 4 && points.every((point) =>
    point.lane >= -0.25 && point.lane <= 2.25 &&
    point.column >= -0.25 && point.column <= 6.25);
}

function readCoordinate(value, axis) {
  const capitalized = axis === "lane" ? "Lane" : "Column";
  const raw = value?.[axis] ??
    value?.[capitalized] ??
    value?.fieldPosition?.[axis] ??
    value?.fieldPosition?.[capitalized];
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function normalizeCoordinate(value, axis, legacyGrid) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (!legacyGrid) {
    return value;
  }

  return axis === "lane"
    ? (value + 0.5) * (field.lanes / 3)
    : (value + 0.5) * (field.columns / 7);
}

function normalizeNullableCoordinate(value, axis, legacyGrid) {
  return Number.isFinite(value)
    ? normalizeCoordinate(value, axis, legacyGrid)
    : null;
}

function finiteNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

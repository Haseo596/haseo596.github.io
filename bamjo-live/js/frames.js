import { normalizeId } from "./utils.js";

export function normalizeFrame(message) {
  return {
    tick: Number(message.tick || 0),
    timeMs: finiteNumberOrNull(message.timeMs),
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
      columnVelocity: Number(message.ball?.columnVelocity || 0),
      targetLane: finiteNumberOrNull(message.ball?.targetLane),
      targetColumn: finiteNumberOrNull(message.ball?.targetColumn)
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
      offset: finiteNumberOrNull(event.offset),
      timeMs: finiteNumberOrNull(event.timeMs),
      text: String(event.text || ""),
      lane: finiteNumberOrNull(event.lane),
      column: finiteNumberOrNull(event.column),
      tags: (event.tags || []).map((tag) => String(tag)),
      visible: event.visible !== false
    }))
  };
}

function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

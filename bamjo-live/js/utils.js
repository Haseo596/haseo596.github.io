import { field } from "./state.js";

export function cellToPercent(lane, column) {
  return {
    x: ((clamp(column, 0, field.columns - 1) + 0.5) / field.columns) * 100,
    y: ((clamp(lane, 0, field.lanes - 1) + 0.5) / field.lanes) * 100
  };
}

export function teamColor(team) {
  return team === "blue" ? "#3887e8" : "#d94747";
}

export function heroImage(hero) {
  return `../images/${encodeURIComponent(String(hero || "shaman").toLowerCase())}.png`;
}

export function cssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function normalizeId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "number" ? value : String(value);
}

export function findPlayer(players, id) {
  if (id === null || id === undefined) {
    return null;
  }

  return players.find((player) => String(player.id) === String(id)) || null;
}

export function trimSet(set, maxSize) {
  while (set.size > maxSize) {
    set.delete(set.values().next().value);
  }
}

export function formatMatchTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

import { els, state, tickAnimationStretch } from "./state.js?v=0.5.1";
import { projectBallPhysics } from "./ballPhysics.js?v=0.5.1";
import { flushTimelineEvents } from "./events.js?v=0.5.1";
import { getPlaybackTimeMs } from "./timeline.js?v=0.5.1";
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
} from "./utils.js?v=0.5.1";

export function renderFrame(now) {
  updateMatchStatus();
  const playbackTimeMs = state.usesTimeline ? getPlaybackTimeMs() : null;
  const frame = state.usesTimeline
    ? getTimelineFrame(playbackTimeMs)
    : getInterpolatedFrame(now);
  if (frame) {
    const visualFrame = state.usesTimeline ? continuousTimelineFrame(frame) : frame;
    updateTick(frame.visualTick ?? frame.tick);
    updateScore(frame.score);
    renderPlayers(visualFrame);
    renderObjects(frame);
    renderBall(visualFrame);
    if (state.usesTimeline) {
      flushTimelineEvents(playbackTimeMs, visualFrame);
    }
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
  const players = interpolatePlayers(state.previousFrame.players, state.targetFrame.players, t);

  const visualTick = lerp(state.previousFrame.tick, state.targetFrame.tick, t);

  return {
    ...state.targetFrame,
    tick: visualTick,
    visualTick,
    players,
    ball: interpolateBall(state.previousFrame, state.targetFrame, players, t, now)
  };
}

export function getTimelineFrame(playbackTimeMs) {
  if (state.visualFrames.length > 0) {
    return getVisualTimelineFrame(playbackTimeMs);
  }

  const frames = state.timelineFrames;
  if (frames.length === 0) {
    return getInterpolatedFrame(performance.now());
  }

  let previous = frames[0];
  let next = frames[frames.length - 1];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frameTime(frame) <= playbackTimeMs) {
      previous = frame;
      next = frames[Math.min(i + 1, frames.length - 1)] || frame;
      continue;
    }

    next = frame;
    break;
  }

  const previousTime = frameTime(previous);
  const nextTime = frameTime(next);
  const span = Math.max(1, nextTime - previousTime);
  const t = previous === next ? 0 : clamp((playbackTimeMs - previousTime) / span, 0, 1);
  const players = timelineMotionPlayers(previous.players, next.players, previousTime, playbackTimeMs, t);

  const visualTick = lerp(previous.tick, next.tick, t);

  return {
    ...next,
    tick: visualTick,
    visualTick,
    players,
    ball: interpolateBall(previous, next, players, t, playbackTimeMs)
  };
}

function getVisualTimelineFrame(playbackTimeMs) {
  const frames = state.visualFrames;
  let previous = frames[0];
  let next = frames[frames.length - 1];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frameTime(frame) <= playbackTimeMs) {
      previous = frame;
      next = frames[Math.min(i + 1, frames.length - 1)] || frame;
      continue;
    }

    next = frame;
    break;
  }

  const previousTime = frameTime(previous);
  const nextTime = frameTime(next);
  const span = Math.max(1, nextTime - previousTime);
  const t = previous === next ? 0 : clamp((playbackTimeMs - previousTime) / span, 0, 1);
  const players = interpolatePlayersLinear(previous.players, next.players, t);
  const visualTick = lerp(previous.tick, next.tick, t);

  return {
    ...next,
    tick: visualTick,
    visualTick,
    visual: true,
    players,
    ball: interpolateVisualBall(previous.ball, next.ball, players, t)
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
  const physicsBall = state.usesTimeline
    ? projectTimelineBall(targetFrame, visualPlayers, now)
    : projectBallPhysics(targetFrame, visualPlayers, now);
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

function continuousTimelineFrame(frame) {
  if (frame.visual) {
    return frame;
  }

  return {
    ...frame,
    ball: attachHeldBall(frame.ball, frame.players)
  };
}

function interpolateVisualBall(previousBall, targetBall, visualPlayers, t) {
  const previousHolderId = previousBall?.holderPlayerId;
  const targetHolderId = targetBall?.holderPlayerId;
  const sameHolder =
    previousHolderId !== null &&
    previousHolderId !== undefined &&
    targetHolderId !== null &&
    targetHolderId !== undefined &&
    String(previousHolderId) === String(targetHolderId);

  if (sameHolder) {
    const holder = findPlayer(visualPlayers, targetHolderId);
    if (holder) {
      return {
        ...targetBall,
        lane: holder.lane,
        column: holder.column
      };
    }
  }

  return {
    ...targetBall,
    holderPlayerId: sameHolder ? targetHolderId : null,
    lane: lerp(previousBall?.lane ?? targetBall?.lane ?? 1, targetBall?.lane ?? previousBall?.lane ?? 1, t),
    column: lerp(previousBall?.column ?? targetBall?.column ?? 3, targetBall?.column ?? previousBall?.column ?? 3, t)
  };
}

function timelineMotionPlayers(previousPlayers, targetPlayers, previousTimeMs, playbackTimeMs, fallbackT) {
  const fallbackPlayers = interpolatePlayersLinear(previousPlayers, targetPlayers, fallbackT);
  const fallbackMap = new Map(fallbackPlayers.map((player) => [String(player.id), player]));

  return targetPlayers.map((player) => {
    const fallback = fallbackMap.get(String(player.id)) || player;
    const motion = playerMotionAt(player.id, previousTimeMs, playbackTimeMs);
    const sampled = motion
      ? motionPosition(motion, playbackTimeMs)
      : sampleTimelinePlayer(player.id, previousTimeMs, playbackTimeMs);
    if (!sampled) {
      return fallback;
    }

    return {
      ...fallback,
      lane: clamp(sampled.lane, -0.22, 2.22),
      column: clamp(sampled.column, -0.22, 6.22)
    };
  });
}

function sampleTimelinePlayer(playerId, previousTimeMs, sampleTimeMs) {
  const id = String(playerId);
  const frames = state.timelineFrames;
  if (frames.length < 2) {
    return null;
  }

  let previous = null;
  let next = null;
  for (const frame of frames) {
    const timeMs = frameTime(frame);
    if (timeMs <= sampleTimeMs) {
      previous = frame;
      continue;
    }

    next = frame;
    break;
  }

  previous ??= frames[0];
  next ??= frames[frames.length - 1];
  if (frameTime(next) < previousTimeMs) {
    return null;
  }

  const previousPlayer = findPlayer(previous.players, id);
  const nextPlayer = findPlayer(next.players, id) || previousPlayer;
  if (!previousPlayer || !nextPlayer) {
    return null;
  }

  const fromMs = frameTime(previous);
  const toMs = frameTime(next);
  if (toMs <= fromMs) {
    return { lane: nextPlayer.lane, column: nextPlayer.column };
  }

  const t = clamp((sampleTimeMs - fromMs) / (toMs - fromMs), 0, 1);
  return {
    lane: lerp(previousPlayer.lane, nextPlayer.lane, t),
    column: lerp(previousPlayer.column, nextPlayer.column, t)
  };
}

function playerMotionAt(playerId, previousTimeMs, playbackTimeMs) {
  const id = String(playerId);
  let latest = null;

  for (const motion of state.playerMotions) {
    if (motion.fromMs > playbackTimeMs) {
      break;
    }
    if (String(motion.playerId) !== id) {
      continue;
    }

    latest = motion;
    if (motion.toMs >= playbackTimeMs) {
      return motion;
    }
  }

  if (!latest || latest.toMs < previousTimeMs) {
    return null;
  }

  return latest;
}

function motionPosition(motion, playbackTimeMs) {
  const duration = Math.max(1, motion.toMs - motion.fromMs);
  const t = clamp((playbackTimeMs - motion.fromMs) / duration, 0, 1);
  return {
    lane: lerp(motion.fromLane, motion.toLane, t),
    column: lerp(motion.fromColumn, motion.toColumn, t)
  };
}

function projectTimelineBall(frame, visualPlayers, playbackTimeMs) {
  if (!frame?.ball || state.physicsEvents.length === 0) {
    return attachHeldBall(frame?.ball, visualPlayers);
  }

  const eventIndex = timelineBallEventIndex(playbackTimeMs);
  if (eventIndex < 0) {
    return attachHeldBall(frame.ball, visualPlayers);
  }

  const event = state.physicsEvents[eventIndex];
  if (event.kind === "ball_impulse") {
    return timelineBallFlight(frame.ball, visualPlayers, event, playbackTimeMs);
  }

  if (event.kind === "ball_attach") {
    const holderId = event.playerId ?? event.actorId;
    const holder = findPlayer(visualPlayers, holderId);
    if (holder) {
      return {
        ...frame.ball,
        holderPlayerId: holder.id,
        lane: holder.lane,
        column: holder.column
      };
    }
  }

  if (event.kind === "ball_stop" || event.kind === "ball_teleport") {
    return {
      ...frame.ball,
      holderPlayerId: null,
      lane: event.lane,
      column: event.column
    };
  }

  return attachHeldBall(frame.ball, visualPlayers);
}

function timelineBallFlight(ball, visualPlayers, startEvent, playbackTimeMs) {
  const nextEvent = nextBallEvent(startEvent.timeMs);
  const start = eventStartPoint(startEvent, visualPlayers);
  const end = nextEvent
    ? eventEndPoint(nextEvent, startEvent, visualPlayers)
    : fallbackImpulsePoint(startEvent, playbackTimeMs);

  const span = nextEvent
    ? Math.max(1, nextEvent.timeMs - startEvent.timeMs)
    : 1000;
  const t = nextEvent
    ? clamp((playbackTimeMs - startEvent.timeMs) / span, 0, 1)
    : 1;

  return {
    ...ball,
    holderPlayerId: null,
    lane: lerp(start.lane, end.lane, t),
    column: lerp(start.column, end.column, t)
  };
}

function eventStartPoint(event, visualPlayers) {
  return { lane: event.lane, column: event.column };
}

function eventEndPoint(event, startEvent, visualPlayers) {
  if (event.kind === "ball_impulse") {
    return { lane: event.lane, column: event.column };
  }

  if (event.kind === "ball_attach") {
    const holderId = event.playerId ?? event.actorId;
    const sampled = holderId ? sampleTimelinePlayer(holderId, 0, event.timeMs) : null;
    if (sampled) {
      return sampled;
    }

    const holder = holderId ? findPlayer(visualPlayers, holderId) : null;
    if (holder) {
      return { lane: holder.lane, column: holder.column };
    }
  }

  if (event.kind === "ball_stop" && event.source === "goal") {
    return {
      lane: event.lane,
      column: event.column + Math.sign(startEvent.velocityColumn || 0) * 0.42
    };
  }

  return { lane: event.lane, column: event.column };
}

function fallbackImpulsePoint(event, playbackTimeMs) {
  const elapsedSeconds = Math.max(0, (playbackTimeMs - event.timeMs) / 1000);
  return {
    lane: event.lane + event.velocityLane * elapsedSeconds,
    column: event.column + event.velocityColumn * elapsedSeconds
  };
}

function timelineBallEventIndex(playbackTimeMs) {
  let index = -1;
  for (let i = 0; i < state.physicsEvents.length; i++) {
    if (state.physicsEvents[i].timeMs > playbackTimeMs) {
      break;
    }

    index = i;
  }

  return index;
}

function nextBallEvent(afterTimeMs) {
  return state.physicsEvents.find((event) =>
    event.timeMs > afterTimeMs);
}

function continuousPlayers(players, now) {
  const present = new Set();
  const seconds = now / 1000;
  const visualPlayers = players.map((player) => {
    const key = String(player.id);
    present.add(key);

    let motion = state.playerMotion.get(key);
    if (!motion) {
      motion = {
        lane: player.lane,
        column: player.column,
        updatedAt: now
      };
      state.playerMotion.set(key, motion);
    }

    const dt = clamp((now - motion.updatedAt) / 1000, 0, 0.12);
    motion.updatedAt = now;

    const laneDelta = player.lane - motion.lane;
    const columnDelta = player.column - motion.column;
    const distance = Math.hypot(laneDelta, columnDelta);
    if (distance > 3.2 || !Number.isFinite(distance)) {
      motion.lane = player.lane;
      motion.column = player.column;
    } else if (dt > 0) {
      const tau = responseTime(player);
      const alpha = 1 - Math.exp(-dt / tau);
      motion.lane += laneDelta * alpha;
      motion.column += columnDelta * alpha;
    }

    const drift = idleDrift(player, seconds, distance);
    return {
      ...player,
      lane: clamp(motion.lane + drift.lane, -0.22, 2.22),
      column: clamp(motion.column + drift.column, -0.22, 6.22)
    };
  });

  for (const key of state.playerMotion.keys()) {
    if (!present.has(key)) {
      state.playerMotion.delete(key);
    }
  }

  return visualPlayers;
}

function responseTime(player) {
  const seed = hashId(player.id);
  const variation = 0.78 + ((seed % 31) / 100);
  if (player.hasBall) {
    return 0.24 * variation;
  }

  const role = String(player.role || "");
  if (role === "GK") {
    return 0.74 * variation;
  }
  if (role === "MOB") {
    return 0.86 * variation;
  }
  if (role === "FWD") {
    return 1.02 * variation;
  }

  return 1.14 * variation;
}

function idleDrift(player, seconds, distanceToTarget) {
  const seed = hashId(player.id);
  const phase = (seed % 997) / 997 * Math.PI * 2;
  const nearTarget = 1 - clamp(distanceToTarget / 0.55, 0, 1);
  const role = String(player.role || "");
  const base = player.hasBall
    ? 0.006
    : role === "GK"
      ? 0.012
      : 0.035;

  const amplitude = base * nearTarget;
  return {
    lane: Math.sin(seconds * (0.78 + (seed % 7) * 0.03) + phase) * amplitude,
    column: Math.cos(seconds * (0.64 + (seed % 5) * 0.04) + phase * 0.7) * amplitude * 1.25
  };
}

function attachHeldBall(ball, players) {
  if (ball?.holderPlayerId === null || ball?.holderPlayerId === undefined) {
    return ball;
  }

  const holder = findPlayer(players, ball.holderPlayerId);
  if (!holder) {
    return ball;
  }

  return {
    ...ball,
    lane: holder.lane,
    column: holder.column
  };
}

function interpolatePlayers(previousPlayers, targetPlayers, t) {
  const previousMap = new Map(previousPlayers.map((player) => [String(player.id), player]));
  const eased = smoothStep(t);

  return targetPlayers.map((player) => {
    const previous = previousMap.get(String(player.id)) || player;
    return playerVisualPosition(previous, player, eased, t);
  });
}

function interpolatePlayersLinear(previousPlayers, targetPlayers, t) {
  const previousMap = new Map(previousPlayers.map((player) => [String(player.id), player]));

  return targetPlayers.map((player) => {
    const previous = previousMap.get(String(player.id)) || player;
    return {
      ...player,
      lane: clamp(lerp(previous.lane, player.lane, t), -0.18, 2.18),
      column: clamp(lerp(previous.column, player.column, t), -0.18, 6.18)
    };
  });
}

function playerVisualPosition(previous, target, eased, rawT) {
  const laneDelta = target.lane - previous.lane;
  const columnDelta = target.column - previous.column;
  const distance = Math.hypot(laneDelta, columnDelta);
  const offset = playerCellOffset(target);
  let lane = lerp(previous.lane, target.lane, eased);
  let column = lerp(previous.column, target.column, eased);

  if (distance > 0.01) {
    const side = stableSide(target.id);
    const curveStrength = (previous.hasBall || target.hasBall) ? 0.06 : 0.16;
    const curve = Math.sin(Math.PI * rawT) * Math.min(0.22, distance * curveStrength) * side;
    lane += (-columnDelta / distance) * curve;
    column += (laneDelta / distance) * curve;
  }

  lane += offset.lane;
  column += offset.column;

  return {
    ...target,
    lane: clamp(lane, -0.18, 2.18),
    column: clamp(column, -0.18, 6.18)
  };
}

function playerCellOffset(player) {
  const seed = hashId(player.id);
  const laneJitter = (((seed % 101) / 100) - 0.5) * 0.18;
  const columnJitter = ((((Math.floor(seed / 101) % 101) / 100) - 0.5) * 0.16);
  const role = String(player.role || "");

  if (role === "GK") {
    return { lane: laneJitter * 0.45, column: columnJitter * 0.35 };
  }

  if (role === "DEF") {
    return { lane: laneJitter, column: columnJitter - teamDirection(player.team) * 0.04 };
  }

  if (role === "FWD") {
    return { lane: laneJitter, column: columnJitter + teamDirection(player.team) * 0.06 };
  }

  return { lane: laneJitter * 1.15, column: columnJitter };
}

function teamDirection(team) {
  return team === "blue" ? -1 : 1;
}

function stableSide(id) {
  return hashId(id) % 2 === 0 ? 1 : -1;
}

function hashId(id) {
  const text = String(id ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }

  return hash || 1;
}

function smoothStep(t) {
  const value = clamp(t, 0, 1);
  return value * value * (3 - 2 * value);
}

function frameTime(frame) {
  const time = Number(frame.timeMs);
  if (Number.isFinite(time)) {
    return time;
  }

  const tickDurationMs = Number(state.info?.tickDurationMs || state.animationDurationMs || 2800);
  return Number(frame.tick || 0) * tickDurationMs;
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

    const position = cellToPercent(player.lane, player.column, { overflow: 0.2 });
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
  const position = cellToPercent(frame.ball.lane, frame.ball.column, { overflow: 0.48 });
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

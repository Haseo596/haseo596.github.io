export const field = { lanes: 3, columns: 7 };
export const maxEvents = 36;
export const reconnectDelayMs = 2500;
export const playbackDelayMs = 700;
export const tickAnimationStretch = 1;

export const els = {
  matchStatus: document.getElementById("matchStatus"),
  redScore: document.getElementById("redScore"),
  blueScore: document.getElementById("blueScore"),
  tickLabel: document.getElementById("tickLabel"),
  progressBar: document.getElementById("progressBar"),
  matchIdInput: document.getElementById("matchIdInput"),
  connectButton: document.getElementById("connectButton"),
  phaseLabel: document.getElementById("phaseLabel"),
  matchIdLabel: document.getElementById("matchIdLabel"),
  serverTimeLabel: document.getElementById("serverTimeLabel"),
  pitch: document.getElementById("pitch"),
  playersLayer: document.getElementById("playersLayer"),
  objectsLayer: document.getElementById("objectsLayer"),
  effectsLayer: document.getElementById("effectsLayer"),
  ball: document.getElementById("ball"),
  redRoster: document.getElementById("redRoster"),
  blueRoster: document.getElementById("blueRoster"),
  events: document.getElementById("events")
};

export const state = {
  socket: null,
  reconnectTimer: null,
  timelineRequestTimer: null,
  shouldReconnect: false,
  info: null,
  usesTimeline: false,
  previousFrame: null,
  targetFrame: null,
  animationStartedAt: 0,
  animationDurationMs: 2800,
  lastFrameTimeMs: -1,
  connectionAttempt: 0,
  webSocketBase: "",
  playerEls: new Map(),
  objectEls: new Map(),
  eventKeys: new Set(),
  effectKeys: new Set(),
  scheduledFrameKeys: new Set(),
  physicsEventKeys: new Set(),
  pendingTimers: new Set(),
  ballPhysics: null,
  events: []
};

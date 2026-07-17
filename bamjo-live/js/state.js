const coordinateUnitsPerWarcraftUnit = 100 / 4032;
const goalDepth = 128 * coordinateUnitsPerWarcraftUnit;

export const field = {
  lanes: 2624 * coordinateUnitsPerWarcraftUnit,
  columns: 100,
  coordinateMode: "continuous",
  aspectRatio: 4032 / 2624,
  playableColumns: 100 + goalDepth * 2,
  playableAspectRatio: (4032 + 128 * 2) / 2624,
  goalMouthHeight: 576 * coordinateUnitsPerWarcraftUnit,
  goalkeeperAreaDepth: 416 * coordinateUnitsPerWarcraftUnit,
  goalkeeperAreaHeight: 896 * coordinateUnitsPerWarcraftUnit,
  goalDepth,
  goalInteriorHeight: 448 * coordinateUnitsPerWarcraftUnit
};
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
  goalOverlay: document.getElementById("goalOverlay"),
  goalScorer: document.getElementById("goalScorer"),
  matchEndOverlay: document.getElementById("matchEndOverlay"),
  matchEndScore: document.getElementById("matchEndScore"),
  redRoster: document.getElementById("redRoster"),
  blueRoster: document.getElementById("blueRoster"),
  events: document.getElementById("events")
};

export const state = {
  socket: null,
  reconnectTimer: null,
  timelineRequestTimer: null,
  timelineRequestInFlight: false,
  playbackTimeMs: 0,
  playbackLastNow: 0,
  playbackInitialized: false,
  serverFinished: false,
  finalScore: null,
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
  playerMotion: new Map(),
  objectEls: new Map(),
  eventKeys: new Set(),
  effectKeys: new Set(),
  scheduledFrameKeys: new Set(),
  visualFrameKeys: new Set(),
  playerMotionKeys: new Set(),
  timelineEventKeys: new Set(),
  goalEventKeys: new Set(),
  physicsEventKeys: new Set(),
  pendingTimers: new Set(),
  ballPhysics: null,
  visualFrames: [],
  timelineFrames: [],
  playerMotions: [],
  timelineEvents: [],
  goalEvents: [],
  physicsEvents: [],
  events: []
};

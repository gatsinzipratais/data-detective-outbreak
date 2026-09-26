/*
 * Data Detective: Outbreak
 * Cross-device room sync is powered by Firebase Realtime Database.
 */

import { firebaseConfig, firebaseConfigured } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getDatabase,
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const ROLES = [
  {
    id: "epi",
    name: "Epidemiologist",
    icon: "E",
    summary: "Reads patient timelines and symptom patterns.",
    focus: "CASE TIMELINES",
    evidence: [
      { id: "epi-1", title: "A narrow window", detail: "21 of 26 patients became ill 4-10 hours after visiting Riverlight Festival. The clustered timing points to a shared exposure.", key: true },
      { id: "epi-2", title: "No household chain", detail: "Follow-up reports show no meaningful rise among household contacts who skipped the festival.", key: true },
      { id: "epi-3", title: "A common stop", detail: "Most detailed interviews mention a stop near Food Lane C, but memories differ on the exact vendor.", key: true }
    ]
  },
  {
    id: "map",
    name: "Map Analyst",
    icon: "M",
    summary: "Finds location clusters and movement patterns.",
    focus: "LOCATION INTEL",
    evidence: [
      { id: "map-1", title: "The cluster tightens", detail: "Case locations trace back to a 40-meter area at the east end of the festival: Food Lane C.", key: true },
      { id: "map-2", title: "Water is a weak fit", detail: "Patients use three different water-service zones after the festival. A districtwide water-network pattern does not fit.", key: true },
      { id: "map-3", title: "One shared route", detail: "The densest movement overlap happens between the main gate and the Food Lane C seating area.", key: false }
    ]
  },
  {
    id: "hospital",
    name: "Hospital Coordinator",
    icon: "H",
    summary: "Tracks admissions and care-system signals.",
    focus: "HOSPITAL SIGNALS",
    evidence: [
      { id: "hospital-1", title: "A focused wave", detail: "Admissions rose fast overnight, then stabilized. Hospitals are busy but are not seeing a new wave among staff or visitors.", key: true },
      { id: "hospital-2", title: "Similar presentation", detail: "Most patients report the same rapid-onset gastrointestinal symptoms, not a respiratory pattern.", key: true },
      { id: "hospital-3", title: "A capacity choice", detail: "A precise public advisory would reduce avoidable emergency visits more effectively than a broad shutdown.", key: false }
    ]
  },
  {
    id: "lab",
    name: "Lab Specialist",
    icon: "L",
    summary: "Interprets samples and testing options.",
    focus: "LAB FINDINGS",
    evidence: [
      { id: "lab-1", title: "Preliminary screening", detail: "Early samples suggest a foodborne exposure. Results do not support an airborne cause.", key: true },
      { id: "lab-2", title: "One test matters", detail: "A trace assay on retained vendor samples could confirm the likely source before the next service period.", key: true },
      { id: "lab-3", title: "Targeted response", detail: "If a vendor source is confirmed, remove the source and communicate directly with recent festival attendees.", key: true }
    ]
  }
];

const ACTIONS = [
  { id: "trace", icon: "⌁", name: "Run a trace assay", cost: 1, trust: 0, reveal: "Retained samples from Food Lane C show the same contamination marker found in patient samples. The source is food, not water or air." },
  { id: "inspect", icon: "⌕", name: "Inspect Food Lane C", cost: 1, trust: 1, reveal: "Inspectors find a temperature-control failure at a popular Food Lane C stall. The issue is localized, not districtwide." },
  { id: "advisory", icon: "◉", name: "Issue a targeted advisory", cost: 1, trust: 1, reveal: "Festival attendees receive a clear, calm advisory. Incoming misinformation reports decline and trust improves." },
  { id: "water", icon: "≈", name: "Shut down water service", cost: 2, trust: -2, reveal: "The costly shutdown disrupts residents, while the case pattern still does not match a water-network issue." }
];

const SESSION_ROOM_KEY = "dd-room-code";
const SESSION_ROLE_KEY = "dd-role";
const ROOM_PREFIX = "rooms/";
const ROOM_CODE_PATTERN = /^D7-[A-Z0-9]{6}$/;
const $ = (selector) => document.querySelector(selector);
const screens = ["landing", "lobby", "game", "final", "result"];

let app;
let auth;
let database;
let playerId = "";
const savedRoomCode = normalizeRoomCode(sessionStorage.getItem(SESSION_ROOM_KEY));
const savedRole = sessionStorage.getItem(SESSION_ROLE_KEY) || "";
if (!savedRoomCode) {
  sessionStorage.removeItem(SESSION_ROOM_KEY);
  sessionStorage.removeItem(SESSION_ROLE_KEY);
}
if (savedRoomCode && !ROLES.some((role) => role.id === savedRole)) {
  sessionStorage.removeItem(SESSION_ROLE_KEY);
}
let roomCode = savedRoomCode;
let selectedRole = savedRoomCode && ROLES.some((role) => role.id === savedRole) ? savedRole : "";
let roomRef;
let playerRef;
let disconnectTask;
let stopRoomListener;
let stopConnectionListener;
let roomState;
let backendReady = false;
let startupPromise;
let wasConnected = false;
let reconnectInProgress = false;

function initialState() {
  return {
    status: "lobby",
    round: 1,
    time: 6,
    trust: 4,
    actionUsed: false,
    actions: [],
    sharedEvidence: [],
    hypothesis: "",
    players: {},
    lastEvent: "",
    updatedAt: Date.now()
  };
}

function normalizeState(value) {
  const base = initialState();
  const next = Object.assign(base, value || {});
  next.players = (value && value.players) || {};
  next.actions = Array.isArray(value && value.actions) ? value.actions : [];
  next.sharedEvidence = Array.isArray(value && value.sharedEvidence) ? value.sharedEvidence : [];
  next.hypothesis = (value && value.hypothesis) || "";
  next.lastEvent = (value && value.lastEvent) || "";
  return next;
}

function stateForRender() {
  return roomState || initialState();
}

function roomPath(code) {
  return ROOM_PREFIX + code;
}

function normalizeRoomCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : "";
}

function inviteLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  return url.toString();
}

function currentPlayer(state = stateForRender()) {
  return playerId ? state.players[playerId] : undefined;
}

function chosenRole(state = stateForRender()) {
  const player = currentPlayer(state);
  return ROLES.find((role) => role.id === (player && player.roleId));
}

function roleName(roleId) {
  const role = ROLES.find((item) => item.id === roleId);
  return role ? role.name : "Specialist";
}

function showScreen(id) {
  screens.forEach((screen) => $("#" + screen).classList.toggle("hidden", screen !== id));
}

function setBackendMessage(message, state = "") {
  const element = $("#backend-message");
  element.textContent = message;
  element.dataset.state = state;
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(6);
  if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(values);
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    const value = values[index] || Math.floor(Math.random() * alphabet.length);
    suffix += alphabet[value % alphabet.length];
  }
  return "D7-" + suffix;
}

async function initialiseBackend() {
  if (!firebaseConfigured) {
    setBackendMessage("Online rooms will be ready after the Firebase game service is connected.", "pending");
    render();
    return false;
  }

  try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    database = getDatabase(app);
    const credential = await signInAnonymously(auth);
    playerId = credential.user.uid;
    backendReady = true;
    setBackendMessage("Online rooms connected. Invite teammates from any device.", "ready");

    if (roomCode) {
      try {
        await connectToRoom(roomCode, selectedRole);
      } catch (error) {
        console.warn(error);
        await leaveRoom();
        setBackendMessage("Your previous case is no longer available. Host a new case or join a teammate.", "pending");
        render();
      }
    } else {
      render();
    }
    return true;
  } catch (error) {
    console.error(error);
    setBackendMessage("The online game service could not connect. Check the Firebase setup and try again.", "error");
    render();
    return false;
  }
}

async function ensureBackend() {
  if (!startupPromise) startupPromise = initialiseBackend();
  await startupPromise;
  return backendReady;
}

async function createRoom() {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = makeRoomCode();
    const candidateRef = ref(database, roomPath(code));
    const result = await runTransaction(candidateRef, (existing) => {
      if (existing !== null) return;
      return initialState();
    });
    if (result.committed) return code;
  }
  throw new Error("Could not create a unique room.");
}

async function connectToRoom(code, roleToRestore = "") {
  if (stopRoomListener) stopRoomListener();
  if (stopConnectionListener) stopConnectionListener();
  if (disconnectTask) await disconnectTask.cancel();
  playerRef = undefined;
  disconnectTask = undefined;
  wasConnected = false;

  roomCode = code;
  roomRef = ref(database, roomPath(roomCode));
  sessionStorage.setItem(SESSION_ROOM_KEY, roomCode);

  const roomSnapshot = await get(roomRef);
  if (!roomSnapshot.exists()) {
    throw new Error("That room no longer exists.");
  }

  roomState = normalizeState(roomSnapshot.val());
  stopRoomListener = onValue(
    roomRef,
    (snapshot) => {
      roomState = snapshot.exists() ? normalizeState(snapshot.val()) : undefined;
      if (!roomState) {
        setBackendMessage("This room is no longer available. Host a new case to continue.", "error");
        roomCode = "";
        selectedRole = "";
        sessionStorage.removeItem(SESSION_ROOM_KEY);
        sessionStorage.removeItem(SESSION_ROLE_KEY);
      }
      render();
    },
    (error) => {
      console.error(error);
      setBackendMessage("The room connection was interrupted. Refresh to reconnect.", "error");
    }
  );

  if (roleToRestore) {
    const restored = await claimRole(roleToRestore, true);
    if (!restored) {
      selectedRole = "";
      sessionStorage.removeItem(SESSION_ROLE_KEY);
    }
  }
  watchConnection();
  render();
}

async function attachPresence() {
  if (!roomCode || !playerId) return;
  playerRef = ref(database, roomPath(roomCode) + "/players/" + playerId);
  disconnectTask = onDisconnect(playerRef);
  await disconnectTask.remove();
}

function watchConnection() {
  if (stopConnectionListener) stopConnectionListener();
  const connectionRef = ref(database, ".info/connected");
  stopConnectionListener = onValue(connectionRef, (snapshot) => {
    if (!snapshot.val()) {
      wasConnected = false;
      return;
    }

    const reconnecting = wasConnected;
    wasConnected = true;
    void handleConnection(reconnecting);
  });
}

async function handleConnection(reconnecting) {
  if (!roomRef || !playerId) return;

  try {
    await attachPresence();
    if (!reconnecting || !selectedRole || reconnectInProgress) return;

    reconnectInProgress = true;
    const restored = await claimRole(selectedRole, true);
    if (!restored) {
      selectedRole = "";
      sessionStorage.removeItem(SESSION_ROLE_KEY);
    }
  } catch (error) {
    console.warn(error);
  } finally {
    reconnectInProgress = false;
  }
}

async function claimRole(roleId, restoring = false) {
  if (!backendReady || !roomRef || !playerId) return false;
  let roleClaimed = false;

  try {
    // Queue cleanup before the role is written, then re-arm it after reconnects.
    await attachPresence();
    const result = await runTransaction(roomRef, (current) => {
      if (!current) return;
      const next = normalizeState(current);
      const currentPlayer = next.players[playerId];
      if (next.status !== "lobby") {
        if (restoring && currentPlayer && currentPlayer.roleId === roleId) {
          roleClaimed = true;
          return next;
        }
        if (!(restoring && !currentPlayer)) return;
      }
      const occupied = Object.entries(next.players).some(([id, player]) => id !== playerId && player.roleId === roleId);
      if (occupied) return;

      next.players[playerId] = { roleId, joinedAt: Date.now() };
      next.updatedAt = Date.now();
      roleClaimed = true;
      return next;
    });

    if (!result.committed || !roleClaimed) {
      if (!restoring) setBackendMessage("That role was just claimed by another teammate. Choose another lens.", "error");
      return false;
    }

    selectedRole = roleId;
    sessionStorage.setItem(SESSION_ROLE_KEY, selectedRole);
    return true;
  } catch (error) {
    console.error(error);
    setBackendMessage("We could not save that role selection. Try again.", "error");
    return false;
  }
}

async function leaveRoom() {
  if (playerRef) {
    try {
      await remove(playerRef);
      if (disconnectTask) await disconnectTask.cancel();
    } catch (error) {
      console.warn(error);
    }
  }
  if (stopRoomListener) stopRoomListener();
  if (stopConnectionListener) stopConnectionListener();

  roomRef = undefined;
  playerRef = undefined;
  disconnectTask = undefined;
  stopRoomListener = undefined;
  stopConnectionListener = undefined;
  roomState = undefined;
  roomCode = "";
  selectedRole = "";
  wasConnected = false;
  reconnectInProgress = false;
  sessionStorage.removeItem(SESSION_ROOM_KEY);
  sessionStorage.removeItem(SESSION_ROLE_KEY);
}

async function updateState(mutator) {
  if (!backendReady || !roomRef) return false;

  try {
    const result = await runTransaction(roomRef, (current) => {
      if (!current) return;
      const next = normalizeState(current);
      if (mutator(next) === false) return;
      next.updatedAt = Date.now();
      return next;
    });
    return result.committed;
  } catch (error) {
    console.error(error);
    setBackendMessage("The room could not save that change. Check your connection and try again.", "error");
    return false;
  }
}

function renderRoles(state) {
  const activeRoles = new Map(Object.entries(state.players).map(([id, player]) => [player.roleId, id]));
  const mine = currentPlayer(state);

  $("#role-grid").innerHTML = ROLES.map((role) => {
    const owner = activeRoles.get(role.id);
    const unavailable = owner && owner !== playerId;
    const selected = mine && mine.roleId === role.id;
    return '<button class="role-card ' + (selected ? "selected" : "") + '" data-role="' + role.id + '" ' + (unavailable ? "disabled" : "") + '>' +
      '<div class="role-card-top"><span class="role-icon">' + role.icon + '</span><small>' + (unavailable ? "IN USE" : selected ? "SELECTED" : role.focus) + '</small></div>' +
      "<h3>" + role.name + "</h3><p>" + role.summary + "</p></button>";
  }).join("");

  document.querySelectorAll("[data-role]").forEach((button) => {
    button.addEventListener("click", async () => {
      await claimRole(button.dataset.role);
    });
  });
}

function renderLobby(state) {
  $("#room-code").textContent = roomCode || "D7-ABC123";
  renderRoles(state);
  const players = Object.values(state.players).filter((player) => ROLES.some((role) => role.id === player.roleId));
  $("#team-status").innerHTML = players.length
    ? players.map((player) => '<span class="team-member"><i></i>' + roleName(player.roleId) + "</span>").join("")
    : '<span class="team-member">Choose a role to join this room.</span>';

  const start = $("#start-case");
  start.disabled = !currentPlayer(state) || players.length < 2;
  start.textContent = players.length < 2 ? "Need at least 2 players" : "Begin investigation →";
}

function renderPrivateEvidence(state, role) {
  $("#role-title").textContent = role ? role.name : "Select a role";
  $("#role-chip").textContent = role ? role.focus : "—";
  $("#role-instruction").textContent = role
    ? "Tap a clue to reveal it to your team. Your teammates cannot see it until you share it."
    : "Choose a role in the lobby to access your private evidence.";

  $("#private-evidence").innerHTML = role ? role.evidence.map((item, index) => {
    const revealed = state.sharedEvidence.includes(item.id);
    return '<article class="evidence-card ' + (revealed ? "revealed" : "") + '"><button data-evidence="' + item.id + '" ' + (revealed ? "disabled" : "") + ">" +
      '<span class="evidence-number">' + (revealed ? "✓" : index + 1) + "</span><strong>" + item.title + '</strong><span aria-hidden="true">' + (revealed ? "" : "+") + "</span></button>" +
      '<p class="evidence-detail">' + item.detail + "</p></article>";
  }).join("") : "";

  document.querySelectorAll("[data-evidence]").forEach((button) => {
    button.addEventListener("click", async () => {
      const saved = await updateState((next) => {
        if (next.sharedEvidence.includes(button.dataset.evidence)) return false;
        next.sharedEvidence.push(button.dataset.evidence);
      });
      if (!saved) setBackendMessage("That clue was already shared by your team.", "pending");
    });
  });
}

function allEvidence() {
  return ROLES.flatMap((role) => role.evidence.map((item) => Object.assign({}, item, { role: role.name })));
}

function renderSharedBoard(state) {
  const evidence = allEvidence().filter((item) => state.sharedEvidence.includes(item.id));
  $("#intel-count").textContent = evidence.length + " intel";
  const board = $("#shared-evidence");
  board.classList.toggle("empty-board", evidence.length === 0);
  board.innerHTML = evidence.length
    ? evidence.map((item) => '<article class="shared-item"><span>' + item.role.toUpperCase() + "</span><strong>" + item.title + "</strong><p>" + item.detail + "</p></article>").join("")
    : "<p>No intel has been shared yet. Reveal the clues your team needs.</p>";
  $("#hypothesis").value = state.hypothesis || "";
}

function renderActions(state) {
  const actionIsAvailable = !state.actionUsed && state.status === "playing";
  $("#action-state").textContent = state.actionUsed ? "Move logged" : "Awaiting team";
  $("#action-grid").innerHTML = ACTIONS.map((action) => {
    const used = state.actions.includes(action.id);
    const cannotAfford = state.time < action.cost;
    const disabled = !actionIsAvailable || used || cannotAfford;
    return '<button class="action-button" data-action-id="' + action.id + '" ' + (disabled ? "disabled" : "") + ">" +
      "<i>" + action.icon + "</i><strong>" + action.name + "</strong><small>" + (used ? "DONE" : action.cost + " TIME") + "</small></button>";
  }).join("");

  document.querySelectorAll("[data-action-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const actionId = button.dataset.actionId;
      const action = ACTIONS.find((item) => item.id === actionId);
      if (!action) return;

      const saved = await updateState((next) => {
        if (next.actionUsed || next.actions.includes(actionId) || next.time < action.cost || next.status !== "playing") return false;
        next.actions.push(actionId);
        next.time -= action.cost;
        next.trust = Math.max(0, Math.min(6, next.trust + action.trust));
        next.actionUsed = true;
        next.lastEvent = action.reveal;
        if (next.round < 3) {
          next.round += 1;
          next.actionUsed = false;
          next.lastEvent += " Round " + next.round + " is open.";
        } else {
          next.status = "final";
        }
      });

      if (!saved) setBackendMessage("A teammate just logged a move. The updated case board is now shown.", "pending");
    });
  });

  const event = $("#event-card");
  event.classList.toggle("hidden", !state.lastEvent);
  event.textContent = state.lastEvent;
}

function renderGame(state) {
  const role = chosenRole(state);
  $("#round-label").textContent = "ROUND " + state.round + " OF 3";
  $("#clock-label").textContent = state.status === "final" ? "DECIDE" : Math.max(0, state.time) + " UNITS";
  $("#time-value").textContent = state.time;
  $("#trust-value").textContent = state.trust;
  renderPrivateEvidence(state, role);
  renderSharedBoard(state);
  renderActions(state);

  const finalButton = $("#open-final");
  finalButton.disabled = state.status !== "final";
  $("#footer-message").textContent = state.status === "final"
    ? "The window is closing. Agree on your final containment plan."
    : state.lastEvent || "Share evidence and choose your first move.";
}

function renderResult(state) {
  const score = (state.result && state.result.score) || 0;
  $("#result-title").textContent = score >= 85 ? "A careful containment." : score >= 55 ? "A partial containment." : "The surge widened.";
  $("#result-summary").textContent = (state.result && state.result.summary) || "The case is resolved.";
  $("#score-breakdown").innerHTML = [
    [score, "total / 100"],
    [(state.result && state.result.decision) || 0, "decision"],
    [(state.result && state.result.evidence) || 0, "intel"],
    [(state.result && state.result.stewardship) || 0, "stewardship"]
  ].map(([value, label]) => '<div class="score-card"><strong>' + value + "</strong><span>" + label + "</span></div>").join("");
  $("#debrief-text").textContent = (state.result && state.result.debrief) || "Review the case evidence and try again.";
}

function render() {
  if (!backendReady || !roomCode || !roomState) {
    showScreen("landing");
    return;
  }

  const state = stateForRender();
  if (!currentPlayer(state) || state.status === "lobby") {
    showScreen("lobby");
    renderLobby(state);
    return;
  }
  if (state.status === "playing") {
    showScreen("game");
    renderGame(state);
    return;
  }
  if (state.status === "final") {
    showScreen("final");
    return;
  }
  if (state.status === "result") {
    showScreen("result");
    renderResult(state);
  }
}

async function startCase() {
  const saved = await updateState((state) => {
    if (state.status !== "lobby") return false;
    const players = Object.values(state.players).filter((player) => ROLES.some((role) => role.id === player.roleId));
    if (players.length < 2 || !state.players[playerId]) return false;
    state.status = "playing";
    state.round = 1;
    state.time = 6;
    state.trust = 4;
    state.actionUsed = false;
    state.actions = [];
    state.sharedEvidence = [];
    state.hypothesis = "";
    state.lastEvent = "";
    delete state.result;
  });
  if (!saved) setBackendMessage("Two teammates with different roles are needed before the case can start.", "pending");
}

async function saveHypothesis() {
  const hypothesis = $("#hypothesis").value.trim();
  const saved = await updateState((state) => {
    if (state.status !== "playing") return false;
    state.hypothesis = hypothesis;
  });
  if (!saved) setBackendMessage("The case phase changed before that theory could be saved.", "pending");
}

async function submitFinal(form) {
  const data = new FormData(form);
  const correct = data.get("source") === "food" && data.get("pattern") === "common" && data.get("response") === "close";
  const partial = [data.get("source") === "food", data.get("pattern") === "common", data.get("response") === "close"].filter(Boolean).length;

  const saved = await updateState((state) => {
    if (state.status !== "final") return false;
    const evidence = Math.min(30, state.sharedEvidence.length * 3);
    const stewardship = Math.max(0, Math.min(30, 12 + state.time * 4 + state.trust));
    const decision = correct ? 40 : partial * 12;
    const score = evidence + stewardship + decision;
    state.status = "result";
    state.result = {
      score,
      decision,
      evidence,
      stewardship,
      summary: correct
        ? "Your team identified a localized foodborne common exposure and chose a targeted, proportionate response before confidence in the public response collapsed."
        : "The team made some useful connections, but the final containment plan did not fully match the evidence available in the case.",
      debrief: correct
        ? "The key was combining the tight timing, Food Lane C cluster, lack of household transmission, and early lab signal. The strongest teams share their asymmetric clues before acting."
        : "The evidence favored a localized foodborne common exposure at Food Lane C, not airborne spread or a citywide water failure. Share more role-specific evidence and avoid costly broad actions next time."
    };
  });
  if (!saved) setBackendMessage("The final decision was already submitted by a teammate.", "pending");
}

async function resetCase() {
  await updateState((state) => {
    if (state.status !== "result") return false;
    const players = state.players;
    Object.assign(state, initialState(), { players });
  });
}

$("#host-case").addEventListener("click", async () => {
  if (!await ensureBackend()) return;
  try {
    await leaveRoom();
    const code = await createRoom();
    await connectToRoom(code);
    showScreen("lobby");
  } catch (error) {
    console.error(error);
    setBackendMessage("We could not host a case. Try again in a moment.", "error");
  }
});

$("#join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!await ensureBackend()) return;

  const field = $("#join-code");
  const code = normalizeRoomCode(field.value);
  if (!code) {
    field.setCustomValidity("Enter a room code in the format D7-ABC123.");
    field.reportValidity();
    return;
  }
  field.setCustomValidity("");

  try {
    const snapshot = await get(ref(database, roomPath(code)));
    if (!snapshot.exists()) {
      field.setCustomValidity("We could not find that case. Check the invite and try again.");
      field.reportValidity();
      return;
    }
    await leaveRoom();
    await connectToRoom(code);
    showScreen("lobby");
  } catch (error) {
    console.error(error);
    setBackendMessage("We could not join that room. Check your connection and try again.", "error");
  }
});

$("#how-to-play").addEventListener("click", () => $("#how-dialog").showModal());
$("#open-objective").addEventListener("click", () => $("#objective-dialog").showModal());
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $("#" + button.dataset.closeDialog).close()));
$("#copy-room").addEventListener("click", async () => {
  const invite = "Join my Data Detective: Outbreak case\n" + inviteLink() + "\nRoom code: " + roomCode;
  try {
    await navigator.clipboard.writeText(invite);
    $("#copy-room").textContent = "Invite copied";
    setTimeout(() => { $("#copy-room").textContent = "Copy invite"; }, 1400);
  } catch {
    $("#copy-room").textContent = roomCode;
  }
});
$("#start-case").addEventListener("click", startCase);
$("#save-hypothesis").addEventListener("click", saveHypothesis);
$("#open-final").addEventListener("click", async () => {
  const saved = await updateState((state) => {
    if (state.status !== "final") return false;
  });
  if (!saved) setBackendMessage("The team still has investigation moves available.", "pending");
});
$("#final-form").addEventListener("submit", (event) => {
  event.preventDefault();
  submitFinal(event.currentTarget);
});
$("#play-again").addEventListener("click", resetCase);
document.querySelectorAll("[data-action=return-home]").forEach((button) => {
  button.addEventListener("click", async () => {
    await leaveRoom();
    showScreen("landing");
  });
});

const invitedRoom = normalizeRoomCode(new URLSearchParams(window.location.search).get("room"));
if (invitedRoom && !roomCode) {
  $("#join-code").value = invitedRoom;
}

startupPromise = initialiseBackend();

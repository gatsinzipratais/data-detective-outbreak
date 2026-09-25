/* Data Detective: Outbreak - a local, multi-tab cooperative prototype. */

const ROLES = [
  {
    id: "epi",
    name: "Epidemiologist",
    icon: "E",
    summary: "Reads patient timelines and symptom patterns.",
    focus: "CASE TIMELINES",
    evidence: [
      { id: "epi-1", title: "A narrow window", detail: "21 of 26 patients became ill 4–10 hours after visiting Riverlight Festival. The clustered timing points to a shared exposure.", key: true },
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

const STORAGE_PREFIX = "data-detective-outbreak:";
let playerId = sessionStorage.getItem("dd-player-id");
if (!playerId) {
  playerId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  sessionStorage.setItem("dd-player-id", playerId);
}

let roomCode = sessionStorage.getItem("dd-room-code") || "";
let selectedRole = sessionStorage.getItem("dd-role") || "";
let channel;

const $ = (selector) => document.querySelector(selector);
const screens = ["landing", "lobby", "game", "final", "result"];

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

function stateKey() { return `${STORAGE_PREFIX}${roomCode}`; }
function readState() {
  if (!roomCode) return initialState();
  try { return JSON.parse(localStorage.getItem(stateKey())) || initialState(); } catch { return initialState(); }
}
function writeState(next) {
  next.updatedAt = Date.now();
  localStorage.setItem(stateKey(), JSON.stringify(next));
  if (channel) channel.postMessage({ type: "sync" });
  render();
}
function updateState(mutator) {
  const next = readState();
  mutator(next);
  writeState(next);
}
function makeRoomCode() { return `D7-${Math.floor(1000 + Math.random() * 9000)}`; }
function showScreen(id) {
  screens.forEach((screen) => $(`#${screen}`).classList.toggle("hidden", screen !== id));
}
function currentPlayer(state = readState()) { return state.players[playerId]; }
function chosenRole() { return ROLES.find((role) => role.id === selectedRole); }
function roleName(roleId) { return ROLES.find((role) => role.id === roleId)?.name || "Specialist"; }

function joinRoom(code, roleId) {
  roomCode = code;
  selectedRole = roleId;
  sessionStorage.setItem("dd-room-code", roomCode);
  sessionStorage.setItem("dd-role", selectedRole);
  if (channel) channel.close();
  channel = new BroadcastChannel(`${STORAGE_PREFIX}${roomCode}`);
  channel.onmessage = () => render();
  updateState((state) => {
    if (roleId) state.players[playerId] = { roleId, joinedAt: Date.now() };
    else delete state.players[playerId];
  });
}

function leaveRoom() {
  if (roomCode) {
    updateState((state) => { delete state.players[playerId]; });
  }
  if (channel) channel.close();
  channel = undefined;
  roomCode = "";
  selectedRole = "";
  sessionStorage.removeItem("dd-room-code");
  sessionStorage.removeItem("dd-role");
}

function renderRoles(state) {
  const activeRoles = new Map(Object.entries(state.players).map(([id, player]) => [player.roleId, id]));
  $("#role-grid").innerHTML = ROLES.map((role) => {
    const owner = activeRoles.get(role.id);
    const unavailable = owner && owner !== playerId;
    const mine = role.id === selectedRole;
    return `<button class="role-card ${mine ? "selected" : ""}" data-role="${role.id}" ${unavailable ? "disabled" : ""}>
      <div class="role-card-top"><span class="role-icon">${role.icon}</span><small>${unavailable ? "IN USE" : mine ? "SELECTED" : role.focus}</small></div>
      <h3>${role.name}</h3><p>${role.summary}</p>
    </button>`;
  }).join("");
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.addEventListener("click", () => {
      const roleId = button.dataset.role;
      const previous = selectedRole;
      selectedRole = roleId;
      sessionStorage.setItem("dd-role", roleId);
      updateState((next) => {
        if (previous && next.players[playerId]?.roleId === previous) delete next.players[playerId];
        next.players[playerId] = { roleId, joinedAt: Date.now() };
      });
      render();
    });
  });
}

function renderLobby(state) {
  $("#room-code").textContent = roomCode || "D7-0000";
  renderRoles(state);
  const players = Object.values(state.players).filter((player) => ROLES.some((role) => role.id === player.roleId));
  $("#team-status").innerHTML = players.length
    ? players.map((player) => `<span class="team-member"><i></i>${roleName(player.roleId)}</span>`).join("")
    : "<span class=\"team-member\">Choose a role to join this room.</span>";
  const start = $("#start-case");
  start.disabled = !selectedRole || players.length < 2;
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
    return `<article class="evidence-card ${revealed ? "revealed" : ""}"><button data-evidence="${item.id}" ${revealed ? "disabled" : ""}>
      <span class="evidence-number">${revealed ? "✓" : index + 1}</span><strong>${item.title}</strong><span aria-hidden="true">${revealed ? "" : "+"}</span>
    </button><p class="evidence-detail">${item.detail}</p></article>`;
  }).join("") : "";
  document.querySelectorAll("[data-evidence]").forEach((button) => button.addEventListener("click", () => shareEvidence(button.dataset.evidence)));
}

function allEvidence() { return ROLES.flatMap((role) => role.evidence.map((item) => ({ ...item, role: role.name }))); }
function shareEvidence(evidenceId) {
  updateState((state) => {
    if (!state.sharedEvidence.includes(evidenceId)) state.sharedEvidence.push(evidenceId);
  });
}

function renderSharedBoard(state) {
  const evidence = allEvidence().filter((item) => state.sharedEvidence.includes(item.id));
  $("#intel-count").textContent = `${evidence.length} intel`;
  const board = $("#shared-evidence");
  board.classList.toggle("empty-board", evidence.length === 0);
  board.innerHTML = evidence.length ? evidence.map((item) => `<article class="shared-item"><span>${item.role.toUpperCase()}</span><strong>${item.title}</strong><p>${item.detail}</p></article>`).join("") : "<p>No intel has been shared yet. Reveal the clues your team needs.</p>";
  $("#hypothesis").value = state.hypothesis || "";
}

function renderActions(state) {
  const actionIsAvailable = !state.actionUsed && state.status === "playing";
  $("#action-state").textContent = state.actionUsed ? "Move logged" : "Awaiting team";
  $("#action-grid").innerHTML = ACTIONS.map((action) => {
    const used = state.actions.includes(action.id);
    const cannotAfford = state.time < action.cost;
    return `<button class="action-button" data-action-id="${action.id}" ${!actionIsAvailable || used || cannotAfford ? "disabled" : ""}>
      <i>${action.icon}</i><strong>${action.name}</strong><small>${used ? "DONE" : `${action.cost} TIME`}</small></button>`;
  }).join("");
  document.querySelectorAll("[data-action-id]").forEach((button) => button.addEventListener("click", () => takeAction(button.dataset.actionId)));
  const event = $("#event-card");
  event.classList.toggle("hidden", !state.lastEvent);
  event.textContent = state.lastEvent;
}

function takeAction(actionId) {
  const action = ACTIONS.find((item) => item.id === actionId);
  if (!action) return;
  updateState((state) => {
    if (state.actionUsed || state.actions.includes(actionId) || state.time < action.cost) return;
    state.actions.push(actionId);
    state.time -= action.cost;
    state.trust = Math.max(0, Math.min(6, state.trust + action.trust));
    state.actionUsed = true;
    state.lastEvent = action.reveal;
    if (state.round < 3) {
      state.round += 1;
      state.actionUsed = false;
      state.lastEvent += ` Round ${state.round} is open.`;
    } else {
      state.status = "final";
    }
  });
}

function renderGame(state) {
  const role = chosenRole();
  $("#round-label").textContent = `ROUND ${state.round} OF 3`;
  $("#clock-label").textContent = state.status === "final" ? "DECIDE" : `${Math.max(0, state.time)} UNITS`;
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
  const score = state.result?.score || 0;
  $("#result-title").textContent = score >= 85 ? "A careful containment." : score >= 55 ? "A partial containment." : "The surge widened.";
  $("#result-summary").textContent = state.result?.summary || "The case is resolved.";
  $("#score-breakdown").innerHTML = [
    [score, "total / 100"], [state.result?.decision || 0, "decision"], [state.result?.evidence || 0, "intel"], [state.result?.stewardship || 0, "stewardship"]
  ].map(([value, label]) => `<div class="score-card"><strong>${value}</strong><span>${label}</span></div>`).join("");
  $("#debrief-text").textContent = state.result?.debrief || "Review the case evidence and try again.";
}

function render() {
  if (!roomCode) { showScreen("landing"); return; }
  const state = readState();
  if (!currentPlayer(state)) { showScreen("lobby"); renderLobby(state); return; }
  if (state.status === "lobby") { showScreen("lobby"); renderLobby(state); }
  if (state.status === "playing") { showScreen("game"); renderGame(state); }
  if (state.status === "final") { showScreen("final"); }
  if (state.status === "result") { showScreen("result"); renderResult(state); }
}

function startCase() {
  updateState((state) => {
    const validPlayers = Object.values(state.players).filter((player) => ROLES.some((role) => role.id === player.roleId));
    if (validPlayers.length < 2) return;
    state.status = "playing";
    state.round = 1;
    state.time = 6;
    state.trust = 4;
    state.actionUsed = false;
    state.actions = [];
    state.sharedEvidence = [];
    state.hypothesis = "";
    state.lastEvent = "";
  });
}

function saveHypothesis() { updateState((state) => { state.hypothesis = $("#hypothesis").value.trim(); }); }

function submitFinal(form) {
  const data = new FormData(form);
  const correct = data.get("source") === "food" && data.get("pattern") === "common" && data.get("response") === "close";
  const partial = [data.get("source") === "food", data.get("pattern") === "common", data.get("response") === "close"].filter(Boolean).length;
  updateState((state) => {
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
}

function resetCase() {
  updateState((state) => {
    Object.assign(state, initialState(), { players: state.players });
  });
}

$("#host-case").addEventListener("click", () => {
  leaveRoom();
  joinRoom(makeRoomCode(), "");
  showScreen("lobby");
});
$("#join-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const suppliedCode = $("#join-code").value.trim().toUpperCase();
  const code = /^D7-\d{4}$/.test(suppliedCode) ? suppliedCode : "";
  const field = $("#join-code");
  if (!code) {
    field.setCustomValidity("Enter a room code in the format D7-1234.");
    field.reportValidity();
    return;
  }
  field.setCustomValidity("");
  leaveRoom();
  joinRoom(code, "");
  showScreen("lobby");
});
$("#how-to-play").addEventListener("click", () => $("#how-dialog").showModal());
$("#open-objective").addEventListener("click", () => $("#objective-dialog").showModal());
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close()));
$("#copy-room").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(roomCode); $("#copy-room").textContent = "Copied"; setTimeout(() => { $("#copy-room").textContent = "Copy code"; }, 1400); } catch { $("#copy-room").textContent = roomCode; }
});
$("#start-case").addEventListener("click", startCase);
$("#save-hypothesis").addEventListener("click", saveHypothesis);
$("#open-final").addEventListener("click", () => updateState((state) => { state.status = "final"; }));
$("#final-form").addEventListener("submit", (event) => { event.preventDefault(); submitFinal(event.currentTarget); });
$("#play-again").addEventListener("click", resetCase);
document.querySelectorAll("[data-action=return-home]").forEach((button) => button.addEventListener("click", () => { leaveRoom(); showScreen("landing"); }));
window.addEventListener("storage", (event) => { if (event.key === stateKey()) render(); });

if (roomCode) {
  channel = new BroadcastChannel(`${STORAGE_PREFIX}${roomCode}`);
  channel.onmessage = () => render();
}
render();


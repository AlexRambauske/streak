const GIST_CONFIG = {
  gistId: "bedb711136dc6ae92f256749b1d8bf26",
  filename: "streak-data.json"
};

const SECURITY_CONFIG = {
  encryptedPAT: "YP5IYG7SPSXJMs7QeyllBq_8uaRjdPGqRoNPZ_Ym1Ge0dDUWi5uPPvxmCTpWQhBdxr9PYxxbRHM",
  salt: "uV_ZtaTEzWx3m_bnq7HYHw",
  iv: "fgl4i_CRXRE6bfN0",
  iterations: 600000
};

const DEFAULT_ROUTINES = [
  {
    id: "competitive-programming",
    name: "Competitive Programming",
    tiers: [
      { id: "tier-1", name: "Contest Sim / Advanced DP / APIO Prep", target: 1 },
      { id: "tier-2", name: "The Solid Grind", target: 3 },
      { id: "tier-3", name: "The Brick Wall", target: 2 },
      { id: "tier-4", name: "Streak Saver", target: 7 }
    ],
    maxFreezes: 3,
    freezeEarnRate: 7,
    availableFreezes: 3,
    freezeEvents: {},
    activityLog: {},
    streak: 0,
    lastProcessedDate: null
  },
  {
    id: "gym",
    name: "Gym",
    tiers: [
      { id: "tier-1", name: "Heavy Lifts / Shoulder Press PR", target: 1 },
      { id: "tier-2", name: "Standard Session", target: 3 },
      { id: "tier-3", name: "Light Recovery", target: 5 }
    ],
    maxFreezes: 2,
    freezeEarnRate: 10,
    availableFreezes: 2,
    freezeEvents: {},
    activityLog: {},
    streak: 0,
    lastProcessedDate: null
  }
];

const state = {
  routines: [],
  plainPat: null,
  locked: true,
  syncStatus: "Ready",
  selectedDate: new Date(),
  selectedRoutineId: null,
  syncInFlight: null,
  syncRequested: false,
  gistEtag: null,
  syncAbortController: null,
  sessionId: 0
};

const elements = {};
document.addEventListener("DOMContentLoaded", initializeApp);

function initializeApp() {
  try {
    const storedGistId = localStorage.getItem("streak-manager-gist-id");
    const storedFilename = localStorage.getItem("streak-manager-gist-filename");
    if (storedGistId) GIST_CONFIG.gistId = storedGistId;
    if (storedFilename) GIST_CONFIG.filename = storedFilename;
  } catch (error) {
  }
  cacheDom();
  bindEvents();
  setAppLocked(true);
  renderSyncStatus();
}

function cacheDom() {
  elements.lockedScreen = document.getElementById("locked-screen");
  elements.appShell = document.getElementById("app-shell");
  elements.unlockForm = document.getElementById("unlock-form");
  elements.unlockPassword = document.getElementById("unlock-password");
  elements.unlockError = document.getElementById("unlock-error");
  elements.dashboard = document.getElementById("dashboard");
  elements.syncIndicator = document.getElementById("sync-indicator");
  elements.addRoutineBtn = document.getElementById("add-routine-btn");
  elements.settingsBtn = document.getElementById("settings-btn");
  elements.syncBtn = document.getElementById("sync-btn");
  elements.exportBtn = document.getElementById("export-btn");
  elements.importInput = document.getElementById("import-file-input");
  elements.lockBtn = document.getElementById("lock-btn");
  elements.settingsModal = document.getElementById("settings-modal");
  elements.settingsContent = document.getElementById("settings-content");
  elements.closeSettingsBtn = document.getElementById("close-settings-btn");
  elements.dateModal = document.getElementById("date-modal");
  elements.dateModalBody = document.getElementById("date-modal-body");
  elements.dateModalTitle = document.getElementById("date-modal-title");
  elements.closeDateBtn = document.getElementById("close-date-btn");
}

function bindEvents() {
  elements.unlockForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = elements.unlockPassword.value.trim();
    if (!password) {
      setUnlockError("Enter your password.");
      return;
    }

    try {
      const pat = await decryptPatFromConfig(password);
      state.plainPat = pat;
      setUnlockError("");
      if (state.syncInFlight) await state.syncInFlight;
      await loadAppFromGist();
      renderDashboard();
      setAppLocked(false);
      renderSyncStatus();
    } catch (error) {
      state.plainPat = null;
      setAppLocked(true);
      setUnlockError(error.message || "Incorrect password or corrupted configuration.");
    }
  });

  elements.addRoutineBtn.addEventListener("click", () => addRoutine());
  elements.settingsBtn.addEventListener("click", openSettingsModal);
  elements.closeSettingsBtn.addEventListener("click", closeSettingsModal);
  elements.closeDateBtn.addEventListener("click", closeDateModal);
  elements.syncBtn.addEventListener("click", () => syncDataToGist());
  elements.exportBtn.addEventListener("click", exportCurrentData);
  elements.importInput.addEventListener("change", handleImportFile);
  elements.lockBtn.addEventListener("click", lockApplication);

  window.addEventListener("beforeunload", () => {
    state.plainPat = null;
  });
}

function setUnlockError(message) {
  elements.unlockError.textContent = message;
}

function setAppLocked(locked) {
  state.locked = locked;
  elements.lockedScreen.classList.toggle("hidden", !locked);
  elements.appShell.classList.toggle("hidden", locked);
  if (!locked) {
    elements.unlockPassword.value = "";
  }
}

function lockApplication() {
  state.sessionId += 1;
  if (state.syncAbortController) state.syncAbortController.abort();
  state.syncAbortController = null;
  state.syncRequested = false;
  state.plainPat = null;
  state.routines = [];
  state.selectedRoutineId = null;
  elements.dashboard.innerHTML = "";
  setSyncStatus("Locked", "neutral");
  setAppLocked(true);
  setUnlockError("");
  elements.unlockPassword.focus();
}

async function loadAppFromGist() {
  if (!state.plainPat) throw new Error("No decrypted PAT available.");
  if (!GIST_CONFIG.gistId || GIST_CONFIG.gistId === "PASTE_PRIVATE_GIST_ID_HERE") {
    throw new Error("Set your private Gist ID before continuing.");
  }

  const gist = await fetchGitHubGist();
  const fileName = GIST_CONFIG.filename;
  if (!gist.files || !gist.files[fileName]) {
    const defaultData = buildDefaultData();
    await saveDataToGist(defaultData, "Initialized a fresh private gist.");
    state.routines = normalizeData(defaultData).routines;
    setSyncStatus("Initialized", "ok");
    return;
  }

  const gistFile = gist.files[fileName];
  const raw = await readGistFileContent(gistFile);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Gist data is malformed JSON.");
  }

  state.routines = normalizeData(parsed).routines;
  const freezeLedgerBefore = freezeLedgerSignature(state.routines);
  state.routines.forEach((routine) => recalculateRoutine(routine));
  if (freezeLedgerSignature(state.routines) !== freezeLedgerBefore) {
    await saveDataToGist(buildDataPayload(), "Updated weekly goal freeze ledger.");
  }
  setSyncStatus("Loaded", "ok");
}

async function readGistFileContent(gistFile) {
  if (!gistFile || typeof gistFile !== "object") throw new Error("The configured Gist data file is invalid.");
  if (!gistFile.truncated) return gistFile.content || "{}";
  if (!gistFile.raw_url) throw new Error("The Gist data file is truncated and has no raw URL.");

  const response = await fetch(gistFile.raw_url, {
    headers: {
      Authorization: `Bearer ${state.plainPat}`,
      Accept: "application/vnd.github.raw"
    }
  });
  if (!response.ok) throw new Error("The full Gist data file could not be downloaded.");
  return response.text();
}

function freezeLedgerSignature(routines) {
  return JSON.stringify(routines.map((routine) => ({
    id: routine.id,
    freezeEvents: Object.keys(routine.freezeEvents || {})
      .sort()
      .map((key) => [key, routine.freezeEvents[key]])
  })).sort((first, second) => first.id.localeCompare(second.id)));
}

async function fetchGitHubGist() {
  const response = await fetch(`https://api.github.com/gists/${GIST_CONFIG.gistId}`, {
    headers: {
      Authorization: `Bearer ${state.plainPat}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (response.status === 404) throw new Error("The configured Gist was not found. Create the private Gist and paste its ID.");
  if (!response.ok) {
    const text = await response.text();
    if (response.status === 401) throw new Error("The PAT is invalid, revoked, or unauthorized.");
    if (response.status === 403) throw new Error("GitHub rejected the request. Check rate limits or PAT scope.");
    throw new Error(`GitHub request failed: ${text.slice(0, 150) || response.statusText}`);
  }

  state.gistEtag = response.headers.get("ETag");
  return response.json();
}

async function syncDataToGist(customMessage) {
  if (state.locked || !state.plainPat) {
    setSyncStatus("Unlock first", "error");
    return false;
  }

  if (state.syncInFlight) {
    state.syncRequested = true;
    return state.syncInFlight;
  }

  const sessionId = state.sessionId;
  const abortController = new AbortController();
  state.syncAbortController = abortController;
  state.syncInFlight = (async () => {
    try {
      do {
        state.syncRequested = false;
        const payload = buildDataPayload();
        await saveDataToGist(payload, customMessage || "Manual sync completed.", abortController.signal);
      } while (state.syncRequested);
      if (state.sessionId === sessionId) setSyncStatus("Saved", "ok");
      return true;
    } catch (error) {
      if (state.sessionId === sessionId) setSyncStatus(error.message || "Sync failed", "error");
      return false;
    } finally {
      if (state.syncAbortController === abortController) state.syncAbortController = null;
      state.syncInFlight = null;
    }
  })();

  return state.syncInFlight;
}

async function saveDataToGist(payload, statusText, signal) {
  const targetGistId = GIST_CONFIG.gistId;
  const targetFilename = GIST_CONFIG.filename;
  const targetSessionId = state.sessionId;
  const targetEtag = state.gistEtag;
  const headers = {
    Authorization: `Bearer ${state.plainPat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json"
  };
  if (targetEtag) headers["If-Match"] = targetEtag;

  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(`https://api.github.com/gists/${targetGistId}`, {
        method: "PATCH",
        headers,
        signal,
        body: JSON.stringify({ files: { [targetFilename]: { content: JSON.stringify(payload, null, 2) } } })
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      if (attempt === 2) throw error;
      await waitForRetry(attempt);
      continue;
    }

    if (response.ok || ![408, 425, 429].includes(response.status) && response.status < 500) break;
    if (attempt < 2) await waitForRetry(attempt);
  }

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 412) throw new Error("Gist changed elsewhere. Reload before saving to avoid overwriting newer data.");
    throw new Error(`Gist save failed: ${text.slice(0, 180) || response.statusText}`);
  }

  if (state.sessionId === targetSessionId && GIST_CONFIG.gistId === targetGistId && GIST_CONFIG.filename === targetFilename) {
    state.gistEtag = response.headers.get("ETag") || null;
  }
  state.syncStatus = statusText;
  renderSyncStatus();
}

function waitForRetry(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
}

function buildDataPayload() {
  return {
    schemaVersion: 1,
    routines: state.routines.map((routine) => ({
      id: routine.id,
      name: routine.name,
      tiers: routine.tiers.map((tier) => ({ id: tier.id, name: tier.name, target: Number(tier.target) || 1 })),
      maxFreezes: Number(routine.maxFreezes) || 0,
      freezeEarnRate: Number(routine.freezeEarnRate) || 1,
      availableFreezes: clamp(Number(routine.availableFreezes) || 0, 0, Number(routine.maxFreezes) || 0),
      freezeEvents: routine.freezeEvents || {},
      activityLog: routine.activityLog || {},
      streak: Number(routine.streak) || 0,
      weeklyStreak: Number(routine.weeklyStreak) || 0,
      lastProcessedDate: routine.lastProcessedDate || null
    })),
    metadata: {
      updatedAt: new Date().toISOString(),
      appVersion: "1.0.0"
    }
  };
}

function buildDefaultData() {
  return {
    schemaVersion: 1,
    routines: JSON.parse(JSON.stringify(DEFAULT_ROUTINES)),
    metadata: { createdAt: new Date().toISOString(), appVersion: "1.0.0" }
  };
}

function normalizeData(data) {
  const fallback = buildDefaultData();
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) return fallback;
  const source = data && typeof data === "object" ? data : fallback;
  if (source.schemaVersion !== 1) throw new Error("Unsupported Gist data schema. The existing data was left unchanged.");

  if (!Array.isArray(source.routines)) throw new Error("Gist data is missing a valid routines list. The existing data was left unchanged.");
  const routines = source.routines.map(normalizeRoutine);

  const usedIds = new Set();
  routines.forEach((routine, index) => {
    const baseId = slugify(routine.id) || `routine-${index + 1}`;
    let uniqueId = baseId;
    let suffix = 2;
    while (usedIds.has(uniqueId)) {
      uniqueId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    routine.id = uniqueId;
    usedIds.add(uniqueId);
  });

  return { schemaVersion: 1, routines, metadata: source.metadata || fallback.metadata };
}

function normalizeRoutine(routine) {
  const safeRoutine = routine || {};
  const tiers = Array.isArray(safeRoutine.tiers) && safeRoutine.tiers.length
    ? safeRoutine.tiers.map((tier, index) => ({
        id: tier && tier.id ? tier.id : `tier-${index + 1}`,
        name: tier && tier.name ? tier.name : `Tier ${index + 1}`,
        target: Number(tier && tier.target) > 0 ? Number(tier.target) : 1
      }))
    : [{ id: "tier-1", name: "Tier 1", target: 1 }];

  const maxFreezes = Math.max(0, Number(safeRoutine.maxFreezes) || 0);
  const freezeEarnRate = Math.max(1, Number(safeRoutine.freezeEarnRate) || 1);
  const availableFreezes = clamp(Number(safeRoutine.availableFreezes) || maxFreezes, 0, maxFreezes);

  const activityLog = normalizeActivityLog(safeRoutine.activityLog, tiers.length);

  return {
    id: slugify(safeRoutine.id || safeRoutine.name || `routine-${Date.now()}`) || `routine-${Date.now()}`,
    name: safeRoutine.name || "Routine",
    tiers,
    maxFreezes,
    freezeEarnRate,
    availableFreezes,
    freezeEvents: safeRoutine.freezeEvents && typeof safeRoutine.freezeEvents === "object" ? safeRoutine.freezeEvents : {},
    activityLog,
    streak: Number(safeRoutine.streak) || 0,
    weeklyStreak: Number(safeRoutine.weeklyStreak) || 0,
    lastProcessedDate: safeRoutine.lastProcessedDate || null
  };
}

function normalizeActivityLog(activityLog, tierCount) {
  if (!activityLog || typeof activityLog !== "object") return {};
  const today = startOfDay(new Date());
  const normalized = {};

  Object.entries(activityLog).forEach(([dateKey, entry]) => {
    const date = parseDateKey(dateKey);
    const selectedTier = Number(entry && entry.selectedTier);
    if (!isValidDateKey(dateKey) || date > today || !Number.isInteger(selectedTier) || selectedTier < 1 || selectedTier > tierCount) return;
    normalized[dateKey] = { selectedTier };
  });

  return normalized;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function recalculateRoutine(routine) {
  removeObsoleteFreezeEvents(routine);
  rebuildEarnedFreezeEvents(routine);
  processDailyFreezeEvents(routine);
  routine.streak = computeCurrentStreak(routine);
  routine.weeklyStreak = computeCurrentGoalStreak(routine);
  routine.availableFreezes = getAvailableFreezes(routine);
  routine.lastProcessedDate = getLatestLoggedDate(routine.activityLog) || routine.lastProcessedDate || formatDateKey(new Date());
}

function rebuildEarnedFreezeEvents(routine) {
  Object.entries(routine.freezeEvents || {}).forEach(([key, entry]) => {
    if (entry && entry.type === "earned") delete routine.freezeEvents[key];
  });

  const activityDates = Object.keys(routine.activityLog || {})
    .filter((dateKey) => routine.activityLog[dateKey] && typeof routine.activityLog[dateKey].selectedTier === "number")
    .sort();
  const earnRate = Math.max(1, Number(routine.freezeEarnRate) || 1);
  let consecutiveDays = 0;
  let previousDate = null;

  activityDates.forEach((dateKey) => {
    const date = parseDateKey(dateKey);
    if (previousDate && daysBetween(previousDate, date) !== 1) consecutiveDays = 0;
    consecutiveDays += 1;
    if (consecutiveDays % earnRate === 0) {
      routine.freezeEvents[`earned:${dateKey}`] = { type: "earned", date: dateKey };
    }
    previousDate = date;
  });
}

function daysBetween(firstDate, secondDate) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(secondDate) - startOfDay(firstDate)) / millisecondsPerDay);
}

function removeObsoleteFreezeEvents(routine) {
  const trackingStart = getEarliestTrackingDate(routine);
  const firstTrackedWeek = trackingStart ? getWeekStart(trackingStart) : null;
  const today = startOfDay(new Date());
  const currentWeek = getWeekStart(today);

  Object.entries(routine.freezeEvents || {}).forEach(([key, entry]) => {
    if (!entry) return;
    if (entry.type === "consumed" && isValidDateKey(key)) {
      const date = parseDateKey(key);
      if (!trackingStart || date < trackingStart || date > today || routine.activityLog[key]) {
        delete routine.freezeEvents[key];
      }
      return;
    }
    if (entry.type === "weekly-consumed" && key.startsWith("week:")) {
      const weekStart = parseDateKey(key.slice(5));
      if (!firstTrackedWeek || weekStart < firstTrackedWeek || weekStart >= currentWeek || isGoalWeekComplete(routine, weekStart)) {
        delete routine.freezeEvents[key];
      }
    }
  });
}

function processDailyFreezeEvents(routine) {
  const trackingStart = getEarliestTrackingDate(routine);
  if (!trackingStart) return;

  const startDate = startOfDay(trackingStart);
  const cursor = startOfDay(new Date());
  cursor.setDate(cursor.getDate() - 1);
  let availableFreezes = getAvailableFreezes(routine);

  while (cursor >= startDate) {
    const dateKey = formatDateKey(cursor);
    if (!routine.activityLog[dateKey] && !hasDailyFreeze(routine, dateKey)) {
      if (availableFreezes <= 0) break;
      routine.freezeEvents[dateKey] = { type: "consumed", date: dateKey };
      availableFreezes -= 1;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
}

function hasDailyFreeze(routine, dateKey) {
  const entry = routine.freezeEvents && routine.freezeEvents[dateKey];
  return Boolean(entry && entry.type === "consumed");
}

function getAvailableFreezes(routine) {
  const events = routine.freezeEvents || {};
  const earned = Object.values(events).filter((entry) => entry && entry.type === "earned").length;
  const consumed = Object.values(events).filter((entry) => entry && (entry.type === "consumed" || entry.type === "weekly-consumed")).length;
  return clamp((Number(routine.maxFreezes) || 0) - consumed + earned, 0, Number(routine.maxFreezes) || 0);
}

function computeCurrentGoalStreak(routine) {
  const trackingStart = getEarliestTrackingDate(routine);
  if (!trackingStart) return 0;

  const firstTrackedWeek = getWeekStart(trackingStart);
  const previousWeek = getWeekStart(new Date());
  previousWeek.setDate(previousWeek.getDate() - 7);
  let availableFreezes = getAvailableFreezes(routine);
  let streak = 0;

  for (let index = 0; ; index += 1) {
    const weekStart = new Date(previousWeek);
    weekStart.setDate(previousWeek.getDate() - (index * 7));
    if (weekStart < firstTrackedWeek) break;
    const weekKey = formatDateKey(weekStart);
    if (isGoalWeekComplete(routine, weekStart)) {
      streak += 1;
      continue;
    }

    const freezeKey = `week:${weekKey}`;
    const existingFreeze = routine.freezeEvents && routine.freezeEvents[freezeKey];
    if (existingFreeze && existingFreeze.type === "weekly-consumed") {
      streak += 1;
      continue;
    }

    if (availableFreezes <= 0) break;
    routine.freezeEvents[freezeKey] = { type: "weekly-consumed", weekStart: weekKey };
    availableFreezes -= 1;
    streak += 1;
  }

  return streak;
}

function getEarliestTrackingDate(routine) {
  const activityDates = Object.keys(routine.activityLog || {}).filter((key) => {
    return routine.activityLog[key] && typeof routine.activityLog[key].selectedTier === "number";
  });
  if (!activityDates.length) return null;
  return parseDateKey(activityDates.sort()[0]);
}

function isGoalWeekComplete(routine, weekStart) {
  const progress = calculateWeeklyProgress(routine, getWeekDates(formatDateKey(weekStart)));
  return progress.length > 0 && progress.every((item) => item.complete);
}

function getWeekStart(date) {
  const start = startOfDay(date);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  return start;
}

function computeCurrentStreak(routine) {
  const activityKeys = new Set(Object.keys(routine.activityLog || {}).filter((key) => routine.activityLog[key] && typeof routine.activityLog[key].selectedTier === "number"));
  const freezeKeys = new Set(Object.entries(routine.freezeEvents || {}).filter(([key, value]) => isValidDateKey(key) && value && value.type === "consumed").map(([key]) => key));
  const trackingStart = getEarliestTrackingDate(routine);
  if (!trackingStart) return 0;

  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (cursor >= trackingStart) {
    const key = formatDateKey(cursor);
    if (activityKeys.has(key) || freezeKeys.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  return streak;
}

function getLatestLoggedDate(activityLog) {
  const keys = Object.keys(activityLog || {}).filter((key) => activityLog[key] && typeof activityLog[key].selectedTier === "number");
  if (!keys.length) return null;
  return keys.sort().at(-1) || null;
}

function isValidDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return false;
  const date = parseDateKey(dateKey);
  return !Number.isNaN(date.getTime()) && formatDateKey(date) === dateKey;
}

function renderDashboard() {
  elements.dashboard.innerHTML = "";
  if (!state.routines.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<div><h3>No routines yet</h3><p>Add a routine to start tracking.</p></div>";
    elements.dashboard.appendChild(empty);
    return;
  }

  state.routines.forEach((routine) => {
    const card = document.createElement("article");
    card.className = "routine-card";

    const summary = document.createElement("div");
    summary.className = "routine-summary";
    summary.innerHTML = `
      <div>
        <p class="eyebrow">Routine</p>
        <h3>${escapeHtml(routine.name)}</h3>
      </div>
      <div class="routine-actions">
        <button type="button" class="action-chip" data-action="rename" data-routine-id="${routine.id}">Rename</button>
        <button type="button" class="action-chip" data-action="add-tier" data-routine-id="${routine.id}">+ Tier</button>
        <button type="button" class="action-chip danger-btn" data-action="delete" data-routine-id="${routine.id}">Delete</button>
      </div>
    `;

    const stats = document.createElement("div");
    stats.className = "routine-stats";
    stats.innerHTML = `
      <div class="stat-box"><span>Current streak</span><strong>${routine.streak || 0}d</strong></div>
      <div class="stat-box"><span>Freezes</span><strong>${routine.availableFreezes || 0}/${routine.maxFreezes || 0}</strong></div>
      <div class="stat-box"><span>Current Goal streak</span><strong>${routine.weeklyStreak || 0}w</strong></div>
    `;

    const progressWrap = document.createElement("div");
    progressWrap.className = "progress-list";
    const weekDates = getWeekDates(formatDateKey(state.selectedDate || new Date()));
    const weeklyProgress = calculateWeeklyProgress(routine, weekDates);
    weeklyProgress.forEach((item) => {
      const pill = document.createElement("div");
      pill.className = `progress-pill ${item.complete ? "complete" : ""}`;
      pill.innerHTML = `<span>${item.label}</span><strong>${item.done}/${item.target}</strong>`;
      progressWrap.appendChild(pill);
    });

    const body = document.createElement("div");
    body.className = "routine-body";

    const calendar = document.createElement("div");
    calendar.className = "calendar-shell";
    calendar.appendChild(buildMonthCalendar(routine));

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";

    const todayMeta = document.createElement("div");
    todayMeta.className = "meta-box";
    const todayValue = routine.activityLog[formatDateKey(new Date())];
    todayMeta.innerHTML = `
      <h5>Today</h5>
      <p>${todayValue && typeof todayValue.selectedTier === "number" ? `Actual: Tier ${todayValue.selectedTier}` : "No activity logged yet"}</p>
    `;

    const recentMeta = document.createElement("div");
    recentMeta.className = "meta-box";
    const recent = getRecentEntries(routine, 5).map((entry) => `<li>${entry.date}: Tier ${entry.selectedTier}</li>`).join("");
    recentMeta.innerHTML = `
      <h5>Recent</h5>
      <ul>${recent || "<li>No recent activity</li>"}</ul>
    `;

    metaRow.append(todayMeta, recentMeta);
    body.append(calendar, metaRow);
    card.append(summary, stats, progressWrap, body);
    elements.dashboard.appendChild(card);
  });

  document.querySelectorAll("[data-action='rename']").forEach((button) => {
    button.addEventListener("click", () => renameRoutine(button.dataset.routineId));
  });
  document.querySelectorAll("[data-action='add-tier']").forEach((button) => {
    button.addEventListener("click", () => addTier(button.dataset.routineId));
  });
  document.querySelectorAll("[data-action='delete']").forEach((button) => {
    button.addEventListener("click", () => deleteRoutine(button.dataset.routineId));
  });
}

function buildMonthCalendar(routine) {
  const monthDate = new Date(state.selectedDate);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;

  const calendarWrap = document.createElement("div");
  calendarWrap.className = "calendar-wrap";

  const header = document.createElement("div");
  header.className = "calendar-header";
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const yearSelect = document.createElement("select");
  yearSelect.className = "calendar-year-select";
  for (let y = 1970; y <= 2100; y += 1) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = String(y);
    if (y === year) option.selected = true;
    yearSelect.appendChild(option);
  }
  yearSelect.addEventListener("change", (event) => {
    const nextDate = new Date(state.selectedDate);
    nextDate.setDate(1);
    nextDate.setFullYear(Number(event.target.value));
    state.selectedDate = nextDate;
    renderDashboard();
  });

  const monthSelect = document.createElement("select");
  monthSelect.className = "calendar-month-select";
  monthNames.forEach((name, idx) => {
    const option = document.createElement("option");
    option.value = String(idx);
    option.textContent = name;
    if (idx === month) option.selected = true;
    monthSelect.appendChild(option);
  });
  monthSelect.addEventListener("change", (event) => {
    const nextDate = new Date(state.selectedDate);
    nextDate.setDate(1);
    nextDate.setMonth(Number(event.target.value));
    state.selectedDate = nextDate;
    renderDashboard();
  });

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "icon-btn";
  prevBtn.textContent = "←";
  prevBtn.addEventListener("click", () => {
    const nextDate = new Date(state.selectedDate);
    nextDate.setDate(1);
    nextDate.setMonth(nextDate.getMonth() - 1);
    state.selectedDate = nextDate;
    renderDashboard();
  });

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "icon-btn";
  nextBtn.textContent = "→";
  nextBtn.addEventListener("click", () => {
    const nextDate = new Date(state.selectedDate);
    nextDate.setDate(1);
    nextDate.setMonth(nextDate.getMonth() + 1);
    state.selectedDate = nextDate;
    renderDashboard();
  });

  header.append(prevBtn, monthSelect, yearSelect, nextBtn);
  const title = document.createElement("h4");
  title.textContent = `${monthNames[month]} ${year}`;
  header.prepend(title);

  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const grid = document.createElement("div");
  grid.className = "calendar-grid";

  weekdays.forEach((dayName) => {
    const dayLabel = document.createElement("div");
    dayLabel.className = "calendar-weekday";
    dayLabel.textContent = dayName;
    grid.appendChild(dayLabel);
  });

  const totalCells = 42;
  for (let index = 0; index < totalCells; index += 1) {
    const date = new Date(year, month, index - firstWeekday + 1);
    const dayKey = formatDateKey(date);
    const futureDate = date > startOfDay(new Date());
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.disabled = futureDate;
    if (date.getMonth() !== month) cell.classList.add("outside");
    if (futureDate) cell.classList.add("future");

    const activity = routine.activityLog[dayKey];
    if (activity && typeof activity.selectedTier === "number") {
      const selectedTier = Number(activity.selectedTier);
      cell.classList.add("actual");
      if (selectedTier < routine.tiers.length) cell.classList.add("cascade");
    }
    if (routine.freezeEvents && routine.freezeEvents[dayKey] && routine.freezeEvents[dayKey].type === "consumed") cell.classList.add("freeze");
    if (!activity && date < startOfDay(new Date()) && date.getMonth() === month) cell.classList.add("missed");

    const dayNumber = document.createElement("span");
    dayNumber.className = "day-number";
    dayNumber.textContent = String(date.getDate());

    const stateLabel = document.createElement("span");
    stateLabel.className = "day-state";
    if (activity && typeof activity.selectedTier === "number") stateLabel.textContent = `Tier ${activity.selectedTier}`;
    else if (routine.freezeEvents && routine.freezeEvents[dayKey] && routine.freezeEvents[dayKey].type === "consumed") stateLabel.textContent = "Freeze";
    else if (date < startOfDay(new Date()) && date.getMonth() === month) stateLabel.textContent = "Missed";
    else if (futureDate) stateLabel.textContent = "Unavailable";
    else stateLabel.textContent = "Open";

    const badge = document.createElement("span");
    badge.className = "day-badge";
    if (activity && typeof activity.selectedTier === "number") badge.textContent = `T${activity.selectedTier}`;
    else if (routine.freezeEvents && routine.freezeEvents[dayKey] && routine.freezeEvents[dayKey].type === "consumed") badge.textContent = "F";
    else badge.textContent = "•";

    cell.append(dayNumber, stateLabel, badge);
    if (!futureDate) cell.addEventListener("click", () => openDateModal(routine, dayKey));
    grid.appendChild(cell);
  }

  calendarWrap.append(header, grid);
  return calendarWrap;
}

function openDateModal(routine, dateKey) {
  if (parseDateKey(dateKey) > startOfDay(new Date())) return;
  state.selectedRoutineId = routine.id;
  state.selectedDate = parseDateKey(dateKey);
  elements.dateModalTitle.textContent = new Date(parseDateKey(dateKey)).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });

  const body = elements.dateModalBody;
  body.innerHTML = "";
  const existing = routine.activityLog[dateKey];
  const selectedTier = existing && typeof existing.selectedTier === "number" ? Number(existing.selectedTier) : null;

  const summary = document.createElement("div");
  summary.className = "date-summary";
  summary.innerHTML = `
    <div><strong>Actual activity:</strong> ${selectedTier ? `Tier ${selectedTier}` : "None"}</div>
    <div><strong>Available tiers:</strong> ${selectedTier ? getSatisfiedTiersForSelection(routine.tiers.length, selectedTier).join(", ") : "None"}</div>
  `;

  const tierOptions = document.createElement("div");
  tierOptions.className = "tier-options";
  routine.tiers.forEach((tier, index) => {
    const tierButton = document.createElement("button");
    tierButton.type = "button";
    tierButton.className = `tier-option-btn ${selectedTier === index + 1 ? "selected" : ""}`;
    tierButton.textContent = `Tier ${index + 1}\n${tier.name}`;
    tierButton.addEventListener("click", () => logTierForDate(routine.id, dateKey, index + 1));
    tierOptions.appendChild(tierButton);
  });

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "modal-secondary";
  clearBtn.textContent = "Clear day";
  clearBtn.addEventListener("click", () => {
    if (routine.activityLog[dateKey]) delete routine.activityLog[dateKey];
    recalculateRoutine(routine);
    renderDashboard();
    closeDateModal();
    if (!state.locked) syncDataToGist(`Updated ${routine.name} on ${dateKey}.`);
  });

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "modal-primary";
  closeBtn.textContent = "Done";
  closeBtn.addEventListener("click", closeDateModal);
  actions.append(clearBtn, closeBtn);

  body.append(summary, tierOptions, actions);
  elements.dateModal.classList.remove("hidden");
}

function closeDateModal() {
  elements.dateModal.classList.add("hidden");
}

async function logTierForDate(routineId, dateKey, selectedTier) {
  if (parseDateKey(dateKey) > startOfDay(new Date())) return;
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine) return;
  routine.activityLog[dateKey] = { selectedTier };
  recalculateRoutine(routine);
  renderDashboard();
  closeDateModal();
  try {
    if (!state.locked) await syncDataToGist(`Logged Tier ${selectedTier} for ${routine.name}.`);
  } catch (error) {
    setSyncStatus(error.message || "Sync failed", "error");
  }
}

function openSettingsModal() {
  const gistSettings = document.createElement("div");
  gistSettings.className = "settings-grid";
  gistSettings.innerHTML = `
    <div class="settings-field"><label for="settings-gist-id">Gist ID</label><input id="settings-gist-id" class="settings-input" value="${escapeAttribute(GIST_CONFIG.gistId)}" /></div>
    <div class="settings-field"><label for="settings-filename">Data file</label><input id="settings-filename" class="settings-input" value="${escapeAttribute(GIST_CONFIG.filename)}" /></div>
  `;

  const routineList = document.createElement("div");
  routineList.className = "routine-settings-list";
  state.routines.forEach((routine) => {
    const card = document.createElement("div");
    card.className = "routine-settings-item";
    card.innerHTML = `
      <div class="settings-grid">
        <div class="settings-field"><label>Routine name</label><input class="settings-input" data-role="routine-name" data-routine-id="${routine.id}" value="${escapeAttribute(routine.name)}" /></div>
        <div class="settings-field"><label>Max freezes</label><input class="settings-input" type="number" min="0" data-role="max-freezes" data-routine-id="${routine.id}" value="${routine.maxFreezes || 0}" /></div>
        <div class="settings-field"><label>Earn every N days</label><input class="settings-input" type="number" min="1" data-role="freeze-rate" data-routine-id="${routine.id}" value="${routine.freezeEarnRate || 1}" /></div>
      </div>
      <div class="tier-editor-list">
        ${routine.tiers.map((tier, index) => `
          <div class="tier-editor-row">
            <input class="settings-input" data-role="tier-name" data-routine-id="${routine.id}" data-tier-index="${index}" value="${escapeAttribute(tier.name)}" />
            <input class="settings-input" type="number" min="1" data-role="tier-target" data-routine-id="${routine.id}" data-tier-index="${index}" value="${tier.target || 1}" />
            <button type="button" class="ghost-btn" data-role="remove-tier" data-routine-id="${routine.id}" data-tier-index="${index}">Remove</button>
          </div>
        `).join("")}
      </div>
      <div class="settings-actions"><button type="button" class="secondary-btn" data-role="add-tier" data-routine-id="${routine.id}">Add tier</button></div>
    `;
    routineList.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  actions.innerHTML = `
    <button type="button" class="secondary-btn" id="settings-add-routine-btn">Add routine</button>
    <button type="button" class="primary-btn" id="settings-save-btn">Save settings</button>
  `;

  elements.settingsContent.innerHTML = "";
  elements.settingsContent.append(gistSettings, routineList, actions);
  elements.settingsModal.classList.remove("hidden");

  document.getElementById("settings-save-btn").addEventListener("click", saveSettingsFromModal);
  document.getElementById("settings-add-routine-btn").addEventListener("click", () => {
    addRoutine();
    openSettingsModal();
  });
  document.querySelectorAll("[data-role='add-tier']").forEach((button) => button.addEventListener("click", () => addTier(button.dataset.routineId)));
  document.querySelectorAll("[data-role='remove-tier']").forEach((button) => button.addEventListener("click", () => removeTier(button.dataset.routineId, Number(button.dataset.tierIndex))));
}

function closeSettingsModal() {
  elements.settingsModal.classList.add("hidden");
}

function saveSettingsFromModal() {
  const gistIdInput = document.getElementById("settings-gist-id");
  const fileInput = document.getElementById("settings-filename");
  if (gistIdInput && gistIdInput.value.trim()) {
    const nextGistId = gistIdInput.value.trim();
    if (nextGistId !== GIST_CONFIG.gistId) state.gistEtag = null;
    GIST_CONFIG.gistId = nextGistId;
    try {
      localStorage.setItem("streak-manager-gist-id", GIST_CONFIG.gistId);
    } catch (error) {
    }
  }
  if (fileInput && fileInput.value.trim()) {
    GIST_CONFIG.filename = fileInput.value.trim();
    try {
      localStorage.setItem("streak-manager-gist-filename", GIST_CONFIG.filename);
    } catch (error) {
    }
  }

  document.querySelectorAll("[data-role='routine-name']").forEach((input) => {
    const routine = state.routines.find((item) => item.id === input.dataset.routineId);
    if (routine) routine.name = input.value.trim() || routine.name;
  });

  document.querySelectorAll("[data-role='max-freezes']").forEach((input) => {
    const routine = state.routines.find((item) => item.id === input.dataset.routineId);
    if (routine) routine.maxFreezes = Math.max(0, Number(input.value) || 0);
  });

  document.querySelectorAll("[data-role='freeze-rate']").forEach((input) => {
    const routine = state.routines.find((item) => item.id === input.dataset.routineId);
    if (routine) routine.freezeEarnRate = Math.max(1, Number(input.value) || 1);
  });

  document.querySelectorAll("[data-role='tier-name']").forEach((input) => {
    const routine = state.routines.find((item) => item.id === input.dataset.routineId);
    if (!routine) return;
    const index = Number(input.dataset.tierIndex);
    if (!routine.tiers[index]) return;
    routine.tiers[index].name = input.value.trim() || `Tier ${index + 1}`;
  });

  document.querySelectorAll("[data-role='tier-target']").forEach((input) => {
    const routine = state.routines.find((item) => item.id === input.dataset.routineId);
    if (!routine) return;
    const index = Number(input.dataset.tierIndex);
    if (!routine.tiers[index]) return;
    routine.tiers[index].target = Math.max(1, Number(input.value) || 1);
  });

  state.routines.forEach((routine) => recalculateRoutine(routine));
  renderDashboard();
  closeSettingsModal();
  if (!state.locked) syncDataToGist("Settings saved.");
}

function addRoutine() {
  const name = window.prompt("Routine name:", "New routine");
  if (!name || !name.trim()) return;

  const routine = {
    id: slugify(`${name.trim()}-${Date.now()}`),
    name: name.trim(),
    tiers: [{ id: "tier-1", name: "Tier 1", target: 1 }],
    maxFreezes: 1,
    freezeEarnRate: 7,
    availableFreezes: 1,
    freezeEvents: {},
    activityLog: {},
    streak: 0,
    lastProcessedDate: null
  };

  state.routines.push(routine);
  recalculateRoutine(routine);
  renderDashboard();
  if (!state.locked) syncDataToGist(`Added ${routine.name}.`);
}

function renameRoutine(routineId) {
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine) return;
  const next = window.prompt("Rename routine:", routine.name);
  if (!next || !next.trim()) return;
  routine.name = next.trim();
  renderDashboard();
  if (!state.locked) syncDataToGist("Renamed routine.");
}

function addTier(routineId) {
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine) return;
  const nextNumber = routine.tiers.length + 1;
  routine.tiers.push({ id: `tier-${nextNumber}`, name: `Tier ${nextNumber}`, target: 1 });
  recalculateRoutine(routine);
  renderDashboard();
  if (!state.locked) syncDataToGist(`Added a tier to ${routine.name}.`);
}

function removeTier(routineId, tierIndex) {
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine || routine.tiers.length <= 1) return;
  routine.tiers.splice(tierIndex, 1);
  routine.tiers = routine.tiers.map((tier, index) => ({ ...tier, id: `tier-${index + 1}`, name: tier.name || `Tier ${index + 1}` }));
  routine.activityLog = normalizeActivityLog(routine.activityLog, routine.tiers.length);
  recalculateRoutine(routine);
  renderDashboard();
  if (!state.locked) syncDataToGist(`Removed a tier from ${routine.name}.`);
}

function deleteRoutine(routineId) {
  const routine = state.routines.find((item) => item.id === routineId);
  if (!routine) return;
  if (!window.confirm(`Delete ${routine.name}?`)) return;
  state.routines = state.routines.filter((item) => item.id !== routineId);
  renderDashboard();
  if (!state.locked) syncDataToGist(`Deleted ${routine.name}.`);
}

function handleImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  file.text().then((text) => {
    const parsed = JSON.parse(text);
    const normalized = normalizeData(parsed);
    state.routines = normalized.routines;
    state.routines.forEach((routine) => recalculateRoutine(routine));
    renderDashboard();
    if (!state.locked) syncDataToGist("Imported data.");
    event.target.value = "";
  }).catch(() => {
    setSyncStatus("Import failed: malformed JSON", "error");
  });
}

function exportCurrentData() {
  const payload = buildDataPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "streak-manager-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  setSyncStatus("Exported", "ok");
}

function getWeeklySummary(routine) {
  const dates = getWeekDates(formatDateKey(new Date()));
  const progress = calculateWeeklyProgress(routine, dates);
  const complete = progress.filter((item) => item.complete).length;
  return `${complete}/${progress.length}`;
}

function calculateWeeklyProgress(routine, dates) {
  const progress = [];
  const log = routine.activityLog || {};
  for (let idx = 0; idx < routine.tiers.length; idx += 1) {
    const tierNumber = idx + 1;
    let done = 0;
    for (const dateKey of dates) {
      const entry = log[dateKey];
      if (!entry || typeof entry.selectedTier !== "number") continue;
      const selectedTier = Number(entry.selectedTier);
      if (selectedTier <= tierNumber) done += 1;
    }
    progress.push({
      label: `T${tierNumber}`,
      target: Number(routine.tiers[idx].target) || 1,
      done,
      complete: done >= (Number(routine.tiers[idx].target) || 1),
      tierNumber
    });
  }
  return progress;
}

function getSatisfiedTiersForSelection(totalTiers, selectedTier) {
  const values = [];
  for (let i = selectedTier; i <= totalTiers; i += 1) values.push(i);
  return values;
}

function getRecentEntries(routine, count = 5) {
  return Object.entries(routine.activityLog || {})
    .filter(([, value]) => value && typeof value.selectedTier === "number")
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, count)
    .map(([date, value]) => ({ date, selectedTier: Number(value.selectedTier) }));
}

function getWeekDates(dateKey) {
  const date = parseDateKey(dateKey);
  const offset = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - offset);
  start.setHours(0, 0, 0, 0);
  const result = [];
  for (let i = 0; i < 7; i += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    result.push(formatDateKey(current));
  }
  return result;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function renderSyncStatus() {
  if (!elements.syncIndicator) return;
  elements.syncIndicator.textContent = state.syncStatus || "Ready";
  const statusClass = state.syncStatus === "Saved" || state.syncStatus === "Loaded" || state.syncStatus === "Initialized" ? "ok" : state.syncStatus === "Locked" ? "neutral" : state.syncStatus.includes("failed") ? "error" : "neutral";
  elements.syncIndicator.className = `sync-indicator ${statusClass}`;
}

function setSyncStatus(message, type) {
  state.syncStatus = message;
  if (!elements.syncIndicator) return;
  elements.syncIndicator.textContent = message;
  elements.syncIndicator.className = `sync-indicator ${type === "ok" ? "ok" : type === "error" ? "error" : "neutral"}`;
}

async function decryptPatFromConfig(password) {
  const config = SECURITY_CONFIG || {};
  const encrypted = config.encryptedPAT;
  const saltValue = config.salt;
  const ivValue = config.iv;
  const iterations = Number(config.iterations) || 600000;

  if (!encrypted || encrypted === "PASTE_ENCRYPTED_PAT_HERE") throw new Error("Paste the encrypted PAT config into SECURITY_CONFIG in app.js.");
  if (!saltValue || !ivValue) throw new Error("The encrypted PAT configuration is incomplete.");

  const key = await deriveKeyFromPassword(password, saltValue, iterations);
  const ivBytes = base64ToUint8Array(ivValue);
  const ciphertext = base64ToUint8Array(encrypted);

  try {
    const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    throw new Error("Incorrect password or corrupted encrypted PAT.");
  }
}

async function deriveKeyFromPassword(password, saltBase64, iterations, keyLengthBits = 256) {
  const saltBytes = base64ToUint8Array(saltBase64);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: keyLengthBits },
    false,
    ["encrypt", "decrypt"]
  );
}

function base64ToUint8Array(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

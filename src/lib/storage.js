// ============================================================
// TabMod — Storage Abstraction Layer
//
// All extension data flows through this module.
// - Uses chrome.storage.local as the primary store
// - Provides CRUD for workspaces, tabs, settings, stats
// - Implements 100ms write debounce for high-frequency ops
// - Manages trash/recycle bin for undo support
// - Handles migration across schema versions
// ============================================================

const STORAGE_KEYS = {
  WORKSPACES: 'workspaces',
  SETTINGS: 'settings',
  STATS: 'stats',
  TRASH: 'trash',
  SCHEMA_VERSION: 'schemaVersion',
  LAST_SESSION: 'lastSession',
  ONBOARDING_DONE: 'onboardingDone',
};

const CURRENT_SCHEMA_VERSION = '1.0.0';

// ---- Defaults ----

const DEFAULT_SETTINGS = {
  theme: 'system',
  language: 'en',
  autoSaveEnabled: true,
  autoSaveIntervalMinutes: 15,
  autoSaveOnClose: true,
  onboardingDone: false,
};

const DEFAULT_STATS = {
  totalTabsSaved: 0,
  totalTabsRestored: 0,
  memorySavedMB: 0,
  firstSaveAt: null,
  lastSaveAt: null,
};

// ---- Debounced Writer ----

let writeTimeout = null;
let pendingWrites = {};

/**
 * Schedule a batched write to chrome.storage.local.
 * Multiple writes within 100ms are merged into one API call.
 * @param {string} key - Storage key
 * @param {*} value - Value to store
 * @returns {Promise<void>}
 */
function scheduleWrite(key, value) {
  pendingWrites[key] = value;

  return new Promise((resolve) => {
    if (writeTimeout) clearTimeout(writeTimeout);
    writeTimeout = setTimeout(async () => {
      const batch = { ...pendingWrites };
      pendingWrites = {};
      writeTimeout = null;
      try {
        await chrome.storage.local.set(batch);
        resolve();
      } catch (err) {
        console.error('[TabMod Storage] Write error:', err);
        resolve();
      }
    }, 100);
  });
}

/**
 * Flush any pending writes immediately.
 * @returns {Promise<void>}
 */
export async function flushWrites() {
  if (writeTimeout) {
    clearTimeout(writeTimeout);
    writeTimeout = null;
    if (Object.keys(pendingWrites).length > 0) {
      const batch = { ...pendingWrites };
      pendingWrites = {};
      try {
        await chrome.storage.local.set(batch);
      } catch (err) {
        console.error('[TabMod Storage] Flush error:', err);
      }
    }
  }
}

// ---- Full State ----

/**
 * Get the full application state from storage.
 * @returns {Promise<{workspaces: Array, settings: object, stats: object, trash: Array}>}
 */
export async function getFullState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.WORKSPACES,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.STATS,
    STORAGE_KEYS.TRASH,
  ]);
  return {
    workspaces: data[STORAGE_KEYS.WORKSPACES] || [],
    settings: { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] },
    stats: { ...DEFAULT_STATS, ...data[STORAGE_KEYS.STATS] },
    trash: data[STORAGE_KEYS.TRASH] || [],
  };
}

// ---- Workspaces ----

/**
 * Get all workspaces.
 * @returns {Promise<Array>}
 */
export async function getWorkspaces() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.WORKSPACES);
  return data[STORAGE_KEYS.WORKSPACES] || [];
}

/**
 * Save a workspace (create or update).
 * @param {object} workspace - Workspace object
 * @returns {Promise<void>}
 */
export async function saveWorkspace(workspace) {
  const workspaces = await getWorkspaces();
  const index = workspaces.findIndex((w) => w.id === workspace.id);
  const entry = {
    ...workspace,
    updatedAt: Date.now(),
  };

  if (index >= 0) {
    workspaces[index] = entry;
  } else {
    workspaces.push({
      ...entry,
      createdAt: Date.now(),
    });
  }

  await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
}

/**
 * Delete a workspace (soft delete — moves to trash).
 * @param {string} workspaceId
 * @returns {Promise<{undoAvailable: boolean}>}
 */
export async function deleteWorkspace(workspaceId) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) return { undoAvailable: false };

  // Move to trash
  const trash = await getTrash();
  trash.push({ ...ws, deletedAt: Date.now(), _type: 'workspace' });
  await trimTrash(trash);
  await scheduleWrite(STORAGE_KEYS.TRASH, trash);

  // Remove from active list
  const remaining = workspaces.filter((w) => w.id !== workspaceId);
  await scheduleWrite(STORAGE_KEYS.WORKSPACES, remaining);

  return { undoAvailable: true };
}

/**
 * Rename a workspace.
 * @param {string} workspaceId
 * @param {string} newName
 * @returns {Promise<void>}
 */
export async function renameWorkspace(workspaceId, newName) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (ws) {
    ws.name = newName.trim();
    ws.updatedAt = Date.now();
    await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
  }
}

/**
 * Get the active (most recently used) workspace, or create "General" if none exist.
 * @returns {Promise<object>}
 */
export async function getOrCreateDefaultWorkspace() {
  const workspaces = await getWorkspaces();
  if (workspaces.length > 0) {
    return workspaces[0];
  }
  const defaultWs = createWorkspaceObject(chrome.i18n.getMessage('workspaceDefault') || 'General');
  workspaces.push(defaultWs);
  await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
  return defaultWs;
}

// ---- Tabs ----

/**
 * Add tabs to a workspace, with URL deduplication.
 * @param {string} workspaceId
 * @param {Array<{url: string, title: string, favicon?: string}>} tabs
 * @returns {Promise<{added: number, deduped: number}>}
 */
export async function addTabsToWorkspace(workspaceId, tabs) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) return { added: 0, deduped: 0 };

  const existingUrls = new Set(ws.tabs.map((t) => t.url));
  let added = 0;
  let deduped = 0;

  for (const tab of tabs) {
    if (!tab.url) continue;
    if (existingUrls.has(tab.url)) {
      // Update existing tab's title and timestamp
      const existing = ws.tabs.find((t) => t.url === tab.url);
      if (existing) {
        existing.title = tab.title || existing.title;
        existing.favicon = tab.favicon || existing.favicon;
        existing.savedAt = Date.now();
      }
      deduped++;
    } else {
      ws.tabs.push({
        id: generateId(),
        url: tab.url,
        title: tab.title || tab.url,
        favicon: tab.favicon || '',
        savedAt: Date.now(),
        pinned: !!tab.pinned,
        muted: !!tab.muted,
        groupId: null,
      });
      existingUrls.add(tab.url);
      added++;
    }
  }

  ws.updatedAt = Date.now();
  await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);

  // Update stats
  await incrementStat('totalTabsSaved', added);

  // Count successful saves for the review prompt (one save operation = +1)
  if (added > 0) {
    await incrementSaveCount();
  }

  // Fire post-save hooks
  if (added > 0) {
    await Promise.allSettled(postSaveHooks.map((fn) => fn({ added, deduped, workspaceId })));
  }

  return { added, deduped };
}

/**
 * Remove a tab from its workspace (soft delete).
 * @param {string} workspaceId
 * @param {string} tabId
 * @returns {Promise<{undoAvailable: boolean}>}
 */
export async function removeTab(workspaceId, tabId) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) return { undoAvailable: false };

  const tabIndex = ws.tabs.findIndex((t) => t.id === tabId);
  if (tabIndex < 0) return { undoAvailable: false };

  const [removedTab] = ws.tabs.splice(tabIndex, 1);

  // Move to trash
  const trash = await getTrash();
  trash.push({ ...removedTab, workspaceId, deletedAt: Date.now(), _type: 'tab' });
  await trimTrash(trash);
  await scheduleWrite(STORAGE_KEYS.TRASH, trash);
  ws.updatedAt = Date.now();
  await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);

  return { undoAvailable: true };
}

/**
 * Restore a single tab into its original workspace.
 * @param {string} workspaceId
 * @param {string} tabId
 * @returns {Promise<boolean>} Success
 */
export async function restoreTab(workspaceId, tabId) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) return false;

  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab) return false;

  try {
    await chrome.tabs.create({ url: tab.url, active: false });
  } catch (err) {
    console.error('[TabMod] Restore tab error:', err);
    return false;
  }

  // Remove from list
  ws.tabs = ws.tabs.filter((t) => t.id !== tabId);
  ws.updatedAt = Date.now();
  await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
  await incrementStat('totalTabsRestored', 1);

  return true;
}

/**
 * Restore all tabs in a workspace (returns tab list for batch processing by SW).
 * @param {string} workspaceId
 * @returns {Promise<Array>} Array of tab objects to restore
 */
export async function getTabsForBatchRestore(workspaceId) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  return ws ? [...ws.tabs] : [];
}

/**
 * Remove tabs that were successfully restored from the workspace.
 * @param {string} workspaceId
 * @param {Array<string>} tabIds - IDs of successfully restored tabs
 * @returns {Promise<void>}
 */
export async function removeRestoredTabs(workspaceId, tabIds) {
  const workspaces = await getWorkspaces();
  const ws = workspaces.find((w) => w.id === workspaceId);
  if (!ws) return;

  ws.tabs = ws.tabs.filter((t) => !tabIds.includes(t.id));
  ws.updatedAt = Date.now();
  await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
  await incrementStat('totalTabsRestored', tabIds.length);
}

// ---- Trash / Undo ----

async function getTrash() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.TRASH);
  return data[STORAGE_KEYS.TRASH] || [];
}

const TRASH_MAX_ITEMS = 500;

function trimTrash(trash) {
  if (trash.length > TRASH_MAX_ITEMS) {
    trash.splice(0, trash.length - TRASH_MAX_ITEMS);
  }
}

/**
 * Undo the last deletion.
 * @returns {Promise<{success: boolean, type?: string}>}
 */
export async function undoLastDelete() {
  const trash = await getTrash();
  if (trash.length === 0) return { success: false };

  const last = trash.pop();
  await scheduleWrite(STORAGE_KEYS.TRASH, trash);

  if (last._type === 'tab') {
    const workspaces = await getWorkspaces();
    const ws = workspaces.find((w) => w.id === last.workspaceId);
    if (ws) {
      delete last._type;
      delete last.workspaceId;
      delete last.deletedAt;
      ws.tabs.push(last);
      ws.updatedAt = Date.now();
      await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
      return { success: true, type: 'tab' };
    }
  } else if (last._type === 'workspace') {
    delete last._type;
    delete last.deletedAt;
    const workspaces = await getWorkspaces();
    workspaces.push(last);
    await scheduleWrite(STORAGE_KEYS.WORKSPACES, workspaces);
    return { success: true, type: 'workspace' };
  }

  return { success: false };
}

/**
 * Clean up expired trash items (older than 7 days).
 * Called daily via chrome.alarms.
 * @returns {Promise<number>} Number of items cleaned
 */
export async function cleanupExpiredTrash() {
  const trash = await getTrash();
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const before = trash.length;
  const remaining = trash.filter((item) => (item.deletedAt || 0) > cutoff);
  await scheduleWrite(STORAGE_KEYS.TRASH, remaining);
  return before - remaining.length;
}

// ---- Settings ----

/**
 * Get current settings (merged with defaults).
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SETTINGS] };
}

/**
 * Update settings (partial merge supported).
 * @param {object} partial - Partial settings object
 * @returns {Promise<object>} Merged settings
 */
export async function updateSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await scheduleWrite(STORAGE_KEYS.SETTINGS, merged);
  return merged;
}

// ---- Stats ----

async function getStats() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  return { ...DEFAULT_STATS, ...data[STORAGE_KEYS.STATS] };
}

async function incrementStat(key, amount = 1) {
  const stats = await getStats();
  stats[key] = (stats[key] || 0) + amount;
  if (key === 'totalTabsSaved' && !stats.firstSaveAt) {
    stats.firstSaveAt = Date.now();
  }
  if (key === 'totalTabsSaved') {
    stats.lastSaveAt = Date.now();
    stats.memorySavedMB = stats.totalTabsSaved * 50; // ~50MB per tab estimate
  }
  await scheduleWrite(STORAGE_KEYS.STATS, stats);
}

/**
 * Get current statistics.
 * @returns {Promise<object>}
 */
export async function getStatsSnapshot() {
  return await getStats();
}

// ---- Storage Cleanup ----

/**
 * Check storage usage and clean up if approaching the 10MB limit.
 * @returns {Promise<{bytesInUse: number, cleaned: number}>}
 */
export async function checkStoragePressure() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  const LIMIT = 8 * 1024 * 1024; // 8MB threshold

  if (bytesInUse > LIMIT) {
    const cleaned = await cleanupExpiredTrash();
    return { bytesInUse: await chrome.storage.local.getBytesInUse(null), cleaned };
  }

  return { bytesInUse, cleaned: 0 };
}

// ---- Clear All ----

/**
 * Clear all local data (with confirmation).
 * @returns {Promise<void>}
 */
export async function clearAllData() {
  await chrome.storage.local.clear();
  // Re-initialize with a default workspace
  const defaultWs = createWorkspaceObject('General');
  await chrome.storage.local.set({ workspaces: [defaultWs], settings: DEFAULT_SETTINGS });
}

// ---- Schema Migration ----

/**
 * Run schema migration if needed.
 * Called from Service Worker on update.
 * @returns {Promise<void>}
 */
export async function runMigrations() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.SCHEMA_VERSION);
  const currentVersion = data[STORAGE_KEYS.SCHEMA_VERSION] || '0.0.0';

  if (currentVersion === CURRENT_SCHEMA_VERSION) return;

  // v1.0.0: Initial schema (no migration needed for fresh installs)
  if (compareVersions(currentVersion, '1.0.0') < 0) {
    // Ensure all workspaces have the correct structure
    const raw = await chrome.storage.local.get(STORAGE_KEYS.WORKSPACES);
    if (raw[STORAGE_KEYS.WORKSPACES]) {
      raw[STORAGE_KEYS.WORKSPACES] = raw[STORAGE_KEYS.WORKSPACES].map((ws) => ({
        id: ws.id || generateId(),
        name: ws.name || 'General',
        tabs: Array.isArray(ws.tabs) ? ws.tabs : [],
        createdAt: ws.createdAt || Date.now(),
        updatedAt: ws.updatedAt || Date.now(),
      }));
      await chrome.storage.local.set(raw);
    }
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.SCHEMA_VERSION]: CURRENT_SCHEMA_VERSION });
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// ---- Session Tracking ----

/**
 * Update the last session timestamp.
 * @returns {Promise<void>}
 */
export async function touchSession() {
  await scheduleWrite(STORAGE_KEYS.LAST_SESSION, Date.now());
}

/**
 * Check if the last session ended abnormally.
 * @returns {Promise<boolean>}
 */
export async function wasCrashed() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_SESSION);
  const last = data[STORAGE_KEYS.LAST_SESSION];
  if (!last) return false;
  // If more than 2 minutes since last session touch, likely a crash
  return Date.now() - last > 2 * 60 * 1000;
}

// ---- Helpers ----

function generateId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return 't_' + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
}

function createWorkspaceObject(name) {
  return {
    id: generateId(),
    name,
    tabs: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ---- Onboarding ----

export async function isOnboardingDone() {
  const data = await chrome.storage.local.get(STORAGE_KEYS.ONBOARDING_DONE);
  return !!data[STORAGE_KEYS.ONBOARDING_DONE];
}

export async function setOnboardingDone() {
  await scheduleWrite(STORAGE_KEYS.ONBOARDING_DONE, true);
}

// ---- Review Prompt Counter ----

/**
 * Increment the successful-save counter used to gate the review prompt.
 * Called from addTabsToWorkspace whenever at least one tab is actually added.
 * Uses a direct write (not scheduleWrite) so the count is durable before the
 * caller returns and can read it back for the trigger check.
 */
async function incrementSaveCount() {
  const data = await chrome.storage.local.get('tm_save_count');
  const count = (data.tm_save_count || 0) + 1;
  await chrome.storage.local.set({ tm_save_count: count });
}

/**
 * Decide whether the review prompt should be shown after a Save All.
 * Conditions: >= 3 successful saves, and the user has not dismissed it yet.
 * @returns {Promise<boolean>}
 */
export async function shouldShowReviewPrompt() {
  const data = await chrome.storage.local.get(['tm_save_count', 'tm_review_prompted']);
  return (data.tm_save_count || 0) >= 3 && data.tm_review_prompted !== true;
}

// ---- Post-Save Hooks (for auto-sync, logging, etc.) ----

const postSaveHooks = [];

/**
 * Register a callback that fires after any tabs are saved.
 * @param {function} fn - Async callback called with { added, deduped, workspaceId }
 */
export function onTabSaved(fn) {
  postSaveHooks.push(fn);
}

// Add hook invocation at the end of addTabsToWorkspace
// (we patch the existing function by wrapping)
// Actually, let's just add it at the end of the function body.
// The function is above — we'll edit it inline.

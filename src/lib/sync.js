// ============================================================
// TabMod — Cloud Sync Orchestrator
//
// Manages sync lifecycle between local storage and Supabase.
// Handles push, pull, conflict resolution, and offline queue.
// ============================================================

import * as storage from './storage.js';
import * as supabase from './supabase.js';

let syncInProgress = false;

async function getDeviceId() {
  const data = await chrome.storage.local.get('_deviceId');
  if (data._deviceId) return data._deviceId;
  const id = 'dev_' + crypto.randomUUID().slice(0, 8);
  await chrome.storage.local.set({ _deviceId: id });
  return id;
}

// ---- Sync Status Events ----

const syncListeners = [];

/**
 * Subscribe to sync status changes.
 * @param {function} callback - Called with { status: 'syncing'|'success'|'error', message?: string }
 */
export function onSyncStatus(callback) {
  syncListeners.push(callback);
}

function notifyListeners(status) {
  syncListeners.forEach((fn) => fn(status));
}

// ---- Core Sync ----

/**
 * Push local workspaces to Supabase.
 * Called after every save operation (debounced).
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function push() {
  if (!supabase.isAuthenticated()) return { success: false, error: 'Not logged in' };
  if (syncInProgress) return { success: false, error: 'Sync already in progress' };

  syncInProgress = true;
  notifyListeners({ status: 'syncing' });

  try {
    const { workspaces } = await storage.getFullState();
    let pushed = 0;

    for (const ws of workspaces) {
      const result = await supabase.upsertWorkspace(ws);
      if (result.success) pushed++;
    }

    // Process offline queue if any
    await processQueue();

    // Update sync metadata
    await supabase.updateSyncMeta(await getDeviceId());

    notifyListeners({ status: 'success', message: `Synced ${pushed} workspaces` });
    return { success: true };
  } catch (err) {
    // Queue failed operations for retry
    await queueFailedSync();
    notifyListeners({ status: 'error', message: err.message });
    return { success: false, error: err.message };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Pull remote workspaces from Supabase and merge into local storage.
 * @returns {Promise<{success: boolean, merged: number, error?: string}>}
 */
export async function pull() {
  if (!supabase.isAuthenticated()) return { success: false, error: 'Not logged in' };
  if (syncInProgress) return { success: false, error: 'Sync already in progress' };

  syncInProgress = true;
  notifyListeners({ status: 'syncing' });

  try {
    const { workspaces: remoteWorkspaces, error } = await supabase.pullWorkspaces();
    if (error) throw new Error(error);

    const { workspaces: localWorkspaces } = await storage.getFullState();
    let merged = 0;

    // Merge remote → local
    for (const remote of remoteWorkspaces) {
      const local = localWorkspaces.find((w) => w.id === remote.id);
      if (!local) {
        // New from remote — add locally
        localWorkspaces.push(remote);
        merged++;
      } else if (remote.updatedAt > local.updatedAt) {
        // Remote is newer — overwrite local
        Object.assign(local, remote);
        merged++;
      }
      // Else local is newer — local wins, will be pushed next cycle
    }

    // Save merged workspaces
    for (const ws of localWorkspaces) {
      await storage.saveWorkspace(ws);
    }

    notifyListeners({ status: 'success', message: `Merged ${merged} changes` });
    return { success: true, merged };
  } catch (err) {
    notifyListeners({ status: 'error', message: err.message });
    return { success: false, error: err.message };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Full sync: push local changes, then pull remote changes.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function fullSync() {
  const pushResult = await push();
  if (!pushResult.success && pushResult.error !== 'Not logged in') {
    return pushResult;
  }
  return await pull();
}

// ---- Offline Queue ----

const QUEUE_KEY = 'syncQueue';

async function processQueue() {
  const data = await chrome.storage.local.get(QUEUE_KEY);
  const queue = data[QUEUE_KEY] || [];
  if (queue.length === 0) return;

  const remaining = [];
  for (const item of queue) {
    try {
      if (item.type === 'workspace_upsert') {
        await supabase.upsertWorkspace(item.data);
      }
    } catch (_) {
      remaining.push(item);
    }
  }

  // Keep only still-failed items, up to 100 max
  if (remaining.length > 0) {
    await chrome.storage.local.set({ [QUEUE_KEY]: remaining.slice(-100) });
  } else {
    await chrome.storage.local.remove(QUEUE_KEY);
  }
}

async function queueFailedSync() {
  const { workspaces } = await storage.getFullState();
  const data = await chrome.storage.local.get(QUEUE_KEY);
  const queue = data[QUEUE_KEY] || [];
  for (const ws of workspaces) {
    queue.push({ type: 'workspace_upsert', data: ws, timestamp: Date.now() });
  }
  await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-100) });
}

// ---- Auth state observer ----

/**
 * Listen for auth state changes (called from popup after login/logout).
 * @param {boolean} loggedIn
 */
export function onAuthChanged(loggedIn) {
  if (loggedIn) {
    // Trigger initial sync on login
    fullSync();
  }
}

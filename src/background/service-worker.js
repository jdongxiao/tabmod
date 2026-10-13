// ============================================================
// TabMod — Service Worker
//
// 🔴 CRITICAL: All event listeners MUST be registered at the top
//    level of this module, inside async callbacks.
//    SW terminates after 30s idle — listeners must survive restart.
//
// Architecture:
//   - Popup opens a long-lived port (chrome.runtime.connect)
//   - All data operations are performed in the SW
//   - Popup only sends requests and renders responses
//   - Timers use chrome.alarms, not setTimeout/setInterval
// ============================================================

import * as storage from '../lib/storage.js';
import { MSG, handlePopupConnection } from '../lib/messaging.js';

// ---- 🔴 TOP-LEVEL: Register all event listeners synchronously ----

// Popup connection (long-lived port)
chrome.runtime.onConnect.addListener((port) => {
  handlePopupConnection(port, MESSAGE_HANDLERS);
});

// One-shot messages (from onboarding page, context menus, etc.)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_ALL_ONBOARDING') {
    handleSaveAllOnboarding(msg.payload, sendResponse);
    return true; // Keep channel open for async response
  }
});

// Extension installed/updated
chrome.runtime.onInstalled.addListener((details) => {
  handleInstalled(details);
});

// Tab closed — trigger auto-save
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleTabClosed(tabId, removeInfo);
});

// Alarm events (auto-save, cleanup, resume restore)
chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm);
});

// Keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  handleCommand(command);
});

// Right-click menu
chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenu(info, tab);
});

// ---- 🔴 TOP-LEVEL END ----
// Everything below is in functions, called from the listeners above.

// ---- Message Handlers ----

const MESSAGE_HANDLERS = {
  [MSG.GET_STATE]: async () => {
    const [state, settings] = await Promise.all([
      storage.getFullState(),
      storage.getSettings(),
    ]);
    return { ...state, settings };
  },

  [MSG.SAVE_ALL]: async () => {
    const tabs = await chrome.tabs.query({});
    const tabData = tabs.map((t) => ({
      url: t.url || '',
      title: t.title || '',
      favicon: t.favIconUrl || '',
      pinned: t.pinned || false,
      muted: t.mutedInfo?.muted || false,
    }));

    const ws = await storage.getOrCreateDefaultWorkspace();
    const result = await storage.addTabsToWorkspace(ws.id, tabData);
    const showReviewPrompt = await storage.shouldShowReviewPrompt();
    return { success: true, added: result.added, deduped: result.deduped, showReviewPrompt };
  },

  [MSG.SAVE_CURRENT]: async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return { success: false, error: 'No active tab found' };

    const ws = await storage.getOrCreateDefaultWorkspace();
    const result = await storage.addTabsToWorkspace(ws.id, [
      {
        url: tab.url || '',
        title: tab.title || '',
        favicon: tab.favIconUrl || '',
      },
    ]);
    return { success: true, added: result.added };
  },

  [MSG.RESTORE_TAB]: async ({ workspaceId, tabId }) => {
    const ok = await storage.restoreTab(workspaceId, tabId);
    return { success: ok };
  },

  [MSG.RESTORE_ALL]: async ({ workspaceId }) => {
    const tabs = await storage.getTabsForBatchRestore(workspaceId);
    if (tabs.length === 0) return { success: true, restored: 0, pending: 0 };

    return await performBatchRestore(workspaceId, tabs);
  },

  [MSG.DELETE_TAB]: async ({ workspaceId, tabId }) => {
    const result = await storage.removeTab(workspaceId, tabId);
    return { ...result, success: true };
  },

  [MSG.DELETE_WORKSPACE]: async ({ workspaceId }) => {
    if (workspaceId === '__all__') {
      await storage.clearAllData();
      return { success: true, allCleared: true };
    }
    const result = await storage.deleteWorkspace(workspaceId);
    return { ...result, success: true };
  },

  [MSG.UNDO_DELETE]: async () => {
    return await storage.undoLastDelete();
  },

  [MSG.SNOOZE_TAB]: async ({ url }) => {
    try {
      const tabs = await chrome.tabs.query({});
      const target = tabs.find((t) => t.url === url);
      if (!target?.id) {
        return { success: true, snoozed: false, note: 'not_open' };
      }
      // Some tabs can't be discarded (chrome:// pages, pinned, last tab)
      await chrome.tabs.discard(target.id);
      return { success: true, snoozed: true };
    } catch (err) {
      return { success: true, snoozed: false, note: 'Cannot snooze this tab (pinned, Chrome page, or last tab)' };
    }
  },

  [MSG.UNSNOOZE_TAB]: async ({ url }) => {
    try {
      await chrome.tabs.create({ url, active: false });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  [MSG.CREATE_WORKSPACE]: async ({ name }) => {
    const ws = {
      id: crypto.randomUUID(),
      name: name || 'New Workspace',
      tabs: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const workspaces = await storage.getWorkspaces();
    workspaces.push(ws);
    for (const w of workspaces) await storage.saveWorkspace(w);
    return { success: true, workspace: ws };
  },

  [MSG.RENAME_WORKSPACE]: async ({ workspaceId, name }) => {
    await storage.renameWorkspace(workspaceId, name);
    return { success: true };
  },

  [MSG.UPDATE_SETTINGS]: async ({ settings }) => {
    const merged = await storage.updateSettings(settings);

    // Handle auto-save interval changes
    if (settings.autoSaveIntervalMinutes !== undefined) {
      chrome.alarms.clear('auto-save');
      if (merged.autoSaveEnabled) {
        chrome.alarms.create('auto-save', {
          periodInMinutes: merged.autoSaveIntervalMinutes,
        });
      }
    }

    return { success: true, settings: merged };
  },

  [MSG.GET_STATS]: async () => {
    const stats = await storage.getStatsSnapshot();
    return stats;
  },

  [MSG.EXPORT_DATA]: async ({ format }) => {
    const state = await storage.getFullState();
    let content, filename, mimeType;

    switch (format) {
      case 'json':
        content = JSON.stringify(state.workspaces, null, 2);
        filename = `tabmod-export-${Date.now()}.json`;
        mimeType = 'application/json';
        break;

      case 'markdown': {
        const lines = ['# TabMod Exported Tabs\n'];
        for (const ws of state.workspaces) {
          lines.push(`## ${ws.name}\n`);
          for (const tab of ws.tabs) {
            lines.push(`- [${tab.title}](${tab.url})`);
          }
          lines.push('');
        }
        content = lines.join('\n');
        filename = `tabmod-export-${Date.now()}.md`;
        mimeType = 'text/markdown';
        break;
      }

      case 'bookmarks': {
        const items = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>'];
        items.push('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
        items.push('<TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p>');
        for (const ws of state.workspaces) {
          items.push(`  <DT><H3>${ws.name}</H3>`);
          items.push('  <DL><p>');
          for (const tab of ws.tabs) {
            const title = escapeHtml(tab.title);
            items.push(`    <DT><A HREF="${tab.url}">${title}</A>`);
          }
          items.push('  </DL><p>');
        }
        items.push('</DL><p>');
        content = items.join('\n');
        filename = `tabmod-export-${Date.now()}.html`;
        mimeType = 'text/html';
        break;
      }

      default:
        return { success: false, error: `Unknown format: ${format}` };
    }

    return { success: true, content, filename, mimeType };
  },

  [MSG.ACTIVATE_LICENSE]: async ({ key }) => {
    // TODO: Implement License Key verification
    // For MVP, return success (actual verification in Sprint 3)
    return { success: true, message: 'License activated (MVP placeholder)' };
  },
};

// ---- Batch Restore with 25-second Time Budget ----

const CHUNK_SIZE = 15;
const TIME_BUDGET_MS = 25000;

/**
 * Restore tabs in batches with a time budget.
 * If budget is exceeded, remaining tabs are saved and restored
 * via a follow-up chrome.alarms event.
 */
async function performBatchRestore(workspaceId, tabs) {
  const startTime = Date.now();
  let restored = 0;
  const restoredIds = [];

  for (let i = 0; i < tabs.length; i += CHUNK_SIZE) {
    // Check time budget
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      // Save remaining tabs and schedule continuation
      const remaining = tabs.slice(i);
      await storage.saveWorkspace({
        id: workspaceId,
        tabs: remaining,
        updatedAt: Date.now(),
      });
      chrome.alarms.create('resume-restore', {
        delayInMinutes: 1,
        periodInMinutes: 1,
      });
      // Store resume state
      await chrome.storage.local.set({
        _resumeRestore: { workspaceId, tabIds: remaining.map((t) => t.id) },
      });
      return { success: true, restored, pending: remaining.length };
    }

    const chunk = tabs.slice(i, i + CHUNK_SIZE);
    const results = await Promise.allSettled(
      chunk.map((tab) =>
        chrome.tabs.create({ url: tab.url, active: false }).catch(() => null)
      )
    );

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) {
        restored++;
        restoredIds.push(chunk[idx].id);
      }
    });
  }

  // All done — remove restored tabs from storage
  if (restoredIds.length > 0) {
    await storage.removeRestoredTabs(workspaceId, restoredIds);
  }

  return { success: true, restored, pending: 0 };
}

// ---- Event Handlers ----

async function handleInstalled(details) {
  if (details.reason === 'install') {
    // Run migrations for fresh install
    await storage.runMigrations();

    // Create default workspace
    await storage.getOrCreateDefaultWorkspace();

    // Set up alarms
    chrome.alarms.create('auto-save', { periodInMinutes: 15 });
    chrome.alarms.create('debounced-save', { periodInMinutes: 1 });
    chrome.alarms.create('cleanup-trash', { periodInMinutes: 60 * 24 });
    chrome.alarms.create('check-storage', { periodInMinutes: 60 });

    // Create context menu items
    chrome.contextMenus.create({
      id: 'save-current',
      title: chrome.i18n.getMessage('contextSaveCurrent'),
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'save-all',
      title: chrome.i18n.getMessage('contextSaveAll'),
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'save-right',
      title: chrome.i18n.getMessage('contextSaveRight'),
      contexts: ['page'],
    });

    // Open onboarding
    const url = chrome.runtime.getURL('src/popup/onboarding.html');
    chrome.tabs.create({ url });
  }

  if (details.reason === 'update') {
    await storage.runMigrations();
  }
}

function handleTabClosed(tabId, removeInfo) {
  // Set debounce flag. The next alarm cycle (within 1 min) will check
  // if this was recent enough to trigger an auto-save.
  chrome.storage.local.get('settings').then((data) => {
    const settings = data.settings || {};
    if (settings.autoSaveOnClose !== false) {
      chrome.storage.local.set({ _lastTabClose: Date.now() });
    }
  });
}

async function handleAlarm(alarm) {
  switch (alarm.name) {
    case 'auto-save': {
      const settings = await storage.getSettings();
      if (settings.autoSaveEnabled) {
        const tabs = await chrome.tabs.query({});
        if (tabs.length > 0) {
          const ws = await storage.getOrCreateDefaultWorkspace();
          const tabData = tabs.map((t) => ({
            url: t.url || '',
            title: t.title || '',
            favicon: t.favIconUrl || '',
          }));
          await storage.addTabsToWorkspace(ws.id, tabData);
        }
      }
      break;
    }

    case 'debounced-save': {
      const data = await chrome.storage.local.get('_lastTabClose');
      const lastClose = data._lastTabClose || 0;
      // If the last tab close was within the last 2 minutes, trigger save.
      // (Alarms have a ~1 min granularity, so we use a 2 min window.)
      if (Date.now() - lastClose < 120000) {
        const tabs = await chrome.tabs.query({});
        if (tabs.length > 0) {
          const ws = await storage.getOrCreateDefaultWorkspace();
          const tabData = tabs.map((t) => ({
            url: t.url || '',
            title: t.title || '',
            favicon: t.favIconUrl || '',
          }));
          await storage.addTabsToWorkspace(ws.id, tabData);
        }
      }
      break;
    }

    case 'cleanup-trash': {
      const cleaned = await storage.cleanupExpiredTrash();
      if (cleaned > 0) {
        console.log(`[TabMod] Cleaned ${cleaned} expired trash items`);
      }
      break;
    }

    case 'check-storage': {
      const { bytesInUse, cleaned } = await storage.checkStoragePressure();
      if (cleaned > 0) {
        console.log(`[TabMod] Storage at ${bytesInUse} bytes, cleaned ${cleaned} items`);
      }
      break;
    }

    case 'resume-restore': {
      const resumeData = await chrome.storage.local.get('_resumeRestore');
      const resume = resumeData._resumeRestore;
      if (resume) {
        // Clear the resume marker
        await chrome.storage.local.remove('_resumeRestore');
        chrome.alarms.clear('resume-restore');

        const tabs = await storage.getTabsForBatchRestore(resume.workspaceId);
        const remainingTabs = tabs.filter((t) => resume.tabIds.includes(t.id));
        if (remainingTabs.length > 0) {
          await performBatchRestore(resume.workspaceId, remainingTabs);
        }
      }
      break;
    }
  }
}

async function handleCommand(command) {
  switch (command) {
    case 'save-all-tabs': {
      const tabs = await chrome.tabs.query({});
      const ws = await storage.getOrCreateDefaultWorkspace();
      const tabData = tabs.map((t) => ({
        url: t.url || '',
        title: t.title || '',
        favicon: t.favIconUrl || '',
      }));
      await storage.addTabsToWorkspace(ws.id, tabData);
      break;
    }

    case 'save-current-tab': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const ws = await storage.getOrCreateDefaultWorkspace();
        await storage.addTabsToWorkspace(ws.id, [
          { url: tab.url, title: tab.title, favicon: tab.favIconUrl },
        ]);
      }
      break;
    }

    case 'open-tabmod': {
      // openPopup is only available in user gesture contexts,
      // but commands count as user gestures
      try {
        await chrome.action.openPopup();
      } catch (_) {
        // Fallback: do nothing, user can click the icon manually
      }
      break;
    }
  }
}

async function handleContextMenu(info, tab) {
  let tabs = [];

  switch (info.menuItemId) {
    case 'save-current':
      if (tab) {
        tabs = [tab];
      }
      break;

    case 'save-all': {
      const allTabs = await chrome.tabs.query({ currentWindow: true });
      tabs = allTabs;
      break;
    }

    case 'save-right': {
      if (tab) {
        const allTabs = await chrome.tabs.query({ currentWindow: true });
        tabs = allTabs.filter((t) => t.index > tab.index);
      }
      break;
    }
  }

  if (tabs.length > 0) {
    const ws = await storage.getOrCreateDefaultWorkspace();
    const tabData = tabs.map((t) => ({
      url: t.url || '',
      title: t.title || '',
      favicon: t.favIconUrl || '',
    }));
    await storage.addTabsToWorkspace(ws.id, tabData);
  }
}

// ---- Crash Detection on SW Start ----

// ---- Onboarding Save Handler ----

async function handleSaveAllOnboarding(payload, sendResponse) {
  try {
    const tabs = payload?.tabs || [];
    const ws = await storage.getOrCreateDefaultWorkspace();
    const result = await storage.addTabsToWorkspace(ws.id, tabs);
    sendResponse({ success: true, added: result.added });
  } catch (err) {
    console.error('[TabMod] Onboarding save error:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// Check for crash on startup (runs only once per SW activation)
// ---- Startup ----

(async function initialize() {
  try {
    // Check for crash
    const crashed = await storage.wasCrashed();
    if (crashed) {
      const tabs = await chrome.tabs.query({});
      if (tabs.length > 0) {
        const ws = await storage.getOrCreateDefaultWorkspace();
        const tabData = tabs.map((t) => ({
          url: t.url || '',
          title: t.title || '',
          favicon: t.favIconUrl || '',
        }));
        await storage.addTabsToWorkspace(ws.id, tabData);
      }
    }

    // Update session timestamp
    await storage.touchSession();
  } catch (_) {
    // SW just started, storage might not be available yet
  }
})();

// ---- Helpers ----

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

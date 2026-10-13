// ============================================================
// TabMod — Popup Main Entry Point
//
// This is the main controller for the extension popup.
// It connects to the Service Worker via the messaging module
// and orchestrates all UI components.
//
// 🔴 MV3: All scripts must be external files (no inline <script>)
// ============================================================

import { connectToSW, onMessage, MSG, createRequest } from '../lib/messaging.js';
import { t, tn, formatNumber, initI18n, applyI18n } from '../lib/i18n.js';
import { renderTabList, refreshTabList, setPortAPI } from '../components/tab-list.js';
import { renderWorkspaceNav } from '../components/workspace-nav.js';
import { showToast } from '../lib/toast.js';

const REVIEW_URL = 'https://chromewebstore.google.com/detail/tabmod/dihmaghebhiabcdampjplpidcjkkaodm/reviews';

// ---- State ----
let state = {
  workspaces: [],
  settings: {},
  stats: {},
  trash: [],
  activeWorkspaceId: null, // null = "All"
};

let portAPI = null;
let currentView = 'tabListView';
let restoreInProgress = false;

// ---- DOM Cache ----
const $ = (id) => document.getElementById(id);

const dom = {
  app: $('app'),
  searchInput: $('searchInput'),
  searchClearBtn: $('searchClearBtn'),
  saveAllBtn: $('saveAllBtn'),
  saveAllLabel: $('saveAllLabel'),
  tabCountBadge: $('tabCountBadge'),
  workspaceNav: $('workspaceNav'),
  tabListContainer: $('tabListContainer'),
  mainContent: $('mainContent'),
  tabListView: $('tabListView'),
  settingsView: $('settingsView'),
  statsView: $('statsView'),
  toolbarSettings: $('toolbarSettings'),
  toolbarStats: $('toolbarStats'),
  toolbarExport: $('toolbarExport'),
  toastContainer: $('toastContainer'),
  statTabsSaved: $('statTabsSaved'),
  statTabsRestored: $('statTabsRestored'),
  statMemorySaved: $('statMemorySaved'),
  themeSelect: $('themeSelect'),
  langSelect: $('langSelect'),
  exportBtn: $('exportBtn'),
  clearBtn: $('clearBtn'),
  autoSaveToggle: $('autoSaveToggle'),
  autoSaveInterval: $('autoSaveInterval'),
};

// ---- Initialization ----

async function init() {
  // Initialize i18n with saved language preference
  await initI18n();
  applyI18n();

  // Connect to Service Worker
  portAPI = connectToSW(handleMessage);
  if (!portAPI) {
    renderError('Connection failed. Please close and reopen the popup.');
    return;
  }

  // Pass portAPI to tab-list component for restore/delete actions
  setPortAPI(portAPI);

  // Request initial state
  portAPI.send(createRequest(MSG.GET_STATE));

  // Set up event listeners
  bindEvents();

  // Apply theme from settings once SW responds
  onMessage(MSG.STATE_UPDATED, (payload) => {
    state = { ...state, ...payload };
    applyTheme(state.settings.theme);

    // Sync settings to UI
    const s = state.settings || {};
    if (dom.autoSaveToggle) {
      dom.autoSaveToggle.setAttribute('aria-checked', s.autoSaveEnabled !== false);
    }
    if (dom.autoSaveInterval) {
      dom.autoSaveInterval.value = String(s.autoSaveIntervalMinutes || 5);
    }
  });
}

// ---- Event Binding ----

function bindEvents() {
  // Save All
  dom.saveAllBtn.addEventListener('click', () => {
    portAPI.send(createRequest(MSG.SAVE_ALL));
    dom.saveAllBtn.classList.add('loading');
  });

  // Search
  dom.searchInput.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    dom.searchClearBtn.hidden = !query;
    renderTabList(state.workspaces, state.activeWorkspaceId, query);
  });

  dom.searchClearBtn.addEventListener('click', () => {
    dom.searchInput.value = '';
    dom.searchClearBtn.hidden = true;
    dom.searchInput.focus();
    renderTabList(state.workspaces, state.activeWorkspaceId, '');
  });

  // Toolbar navigation
  dom.toolbarSettings.addEventListener('click', () => switchView('settingsView'));
  dom.toolbarStats.addEventListener('click', () => {
    switchView('statsView');
    refreshStats();
  });
  dom.toolbarExport.addEventListener('click', handleExport);

  // Settings changes
  dom.themeSelect.addEventListener('change', (e) => {
    portAPI.send(createRequest(MSG.UPDATE_SETTINGS, { settings: { theme: e.target.value } }));
    applyTheme(e.target.value);
  });

  dom.langSelect.addEventListener('change', (e) => {
    portAPI.send(createRequest(MSG.UPDATE_SETTINGS, { settings: { language: e.target.value } }));
    // Reload popup after a brief delay to let settings persist
    setTimeout(() => window.location.reload(), 200);
  });

  // Auto-save
  dom.autoSaveToggle.addEventListener('click', () => {
    const enabled = dom.autoSaveToggle.getAttribute('aria-checked') !== 'true';
    dom.autoSaveToggle.setAttribute('aria-checked', enabled);
    portAPI.send(createRequest(MSG.UPDATE_SETTINGS, {
      settings: { autoSaveEnabled: enabled },
    }));
  });
  dom.autoSaveInterval.addEventListener('change', (e) => {
    portAPI.send(createRequest(MSG.UPDATE_SETTINGS, {
      settings: { autoSaveIntervalMinutes: parseInt(e.target.value) },
    }));
  });

  dom.exportBtn.addEventListener('click', handleExport);
  dom.clearBtn.addEventListener('click', handleClearAll);
}

// ---- View Switching ----

function switchView(viewId) {
  // Hide all views
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.remove('active');
    v.hidden = true;
  });

  // Show target view
  const target = $(viewId);
  if (target) {
    target.classList.add('active');
    target.hidden = false;
  }

  // Don't show tab list when in other views
  if (viewId !== 'tabListView') {
    dom.tabListContainer.innerHTML = '';
  }

  // Update toolbar active state
  document.querySelectorAll('.toolbar-btn').forEach((btn) => btn.classList.remove('active'));
  const toolbarMap = {
    settingsView: dom.toolbarSettings,
    statsView: dom.toolbarStats,
  };
  if (toolbarMap[viewId]) {
    toolbarMap[viewId].classList.add('active');
  }

  // When switching back to tab list, re-render
  if (viewId === 'tabListView') {
    renderTabList(state.workspaces, state.activeWorkspaceId, dom.searchInput.value.trim());
  }

  currentView = viewId;
}

// ---- Message Handler ----

function handleMessage(msg) {
  switch (msg.type) {
    case MSG.STATE_UPDATED: {
      state = { ...state, ...msg.payload };
      applyTheme(state.settings.theme);

      // Update tab count badge
      const totalTabs = state.workspaces.reduce((sum, ws) => sum + ws.tabs.length, 0);
      dom.tabCountBadge.textContent = totalTabs;
      dom.saveAllBtn.classList.remove('loading');

      // Render UI
      renderWorkspaceNav(state.workspaces, state.activeWorkspaceId, onWorkspaceSelect, handleCreateWorkspace);
      renderTabList(state.workspaces, state.activeWorkspaceId, dom.searchInput.value.trim());

      break;
    }

    case MSG.OPERATION_RESULT: {
      const { success, error: errMsg, added, deduped, undoAvailable, snoozed } = msg.payload || {};
      dom.saveAllBtn.classList.remove('loading');

      if (!success && errMsg === 'extension_reloaded') {
        renderError('Extension updated. Please close and reopen the popup.');
        return;
      }

      if (!success) {
        showToast(errMsg || 'Operation failed');
        return;
      }

      // Handle specific operation feedback
      if (added > 0) {
        showToast(tn('tabSaved', added));
      } else if (snoozed !== undefined) {
        if (snoozed) {
          showToast('Tab snoozed — click grey tab to reload');
        }
      }

      // Show the review prompt after a Save All that meets the threshold
      if (msg.payload.showReviewPrompt) {
        showReviewBanner();
      }

      // Refresh state (delay to let debounced writes flush)
      setTimeout(() => portAPI.send(createRequest(MSG.GET_STATE)), 150);
      break;
    }

    case MSG.RESTORE_PROGRESS: {
      const { restored, total } = msg.payload || {};
      showRestoreProgress(restored, total);
      break;
    }

    case MSG.RESTORE_COMPLETE: {
      const { restored: r } = msg.payload || {};
      hideRestoreProgress();
      showToast(tn('tabRestored', r || 0));
      portAPI.send(createRequest(MSG.GET_STATE));
      break;
    }

    case MSG.STATS_RESULT: {
      state.stats = msg.payload;
      updateStatsUI();
      break;
    }

    case MSG.EXPORT_RESULT: {
      const { success, content, filename, mimeType, error: e } = msg.payload || {};
      if (success && content) {
        downloadFile(content, filename, mimeType);
        showToast(t('settingsExportSuccess'));
      } else if (e) {
        showToast(e);
      }
      break;
    }
  }
}

// ---- Workspace Selection ----

function handleCreateWorkspace(name) {
  portAPI.send(createRequest(MSG.CREATE_WORKSPACE, { name }));
}

function onWorkspaceSelect(workspaceId) {
  state.activeWorkspaceId = workspaceId;
  renderWorkspaceNav(state.workspaces, workspaceId, onWorkspaceSelect, handleCreateWorkspace);
  renderTabList(state.workspaces, workspaceId, dom.searchInput.value.trim());

  // Switch back to tab list view if in another view
  if (currentView !== 'tabListView') {
    switchView('tabListView');
  }
}

// ---- Theme ----

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    // Listen for changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      root.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    });
  } else {
    root.setAttribute('data-theme', theme);
  }
}

// ---- Stats ----

function refreshStats() {
  portAPI.send(createRequest(MSG.GET_STATS));
}

function updateStatsUI() {
  const s = state.stats;
  dom.statTabsSaved.textContent = formatNumber(s.totalTabsSaved || 0);
  dom.statTabsRestored.textContent = formatNumber(s.totalTabsRestored || 0);
  dom.statMemorySaved.textContent = `${formatNumber(s.memorySavedMB || 0)} MB`;
}

// ---- Export ----

function handleExport() {
  showExportDialog();
}

function showExportDialog() {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <h3>${t('settingsExport')}</h3>
      <p>Choose export format:</p>
      <div class="export-options" style="display:flex;flex-direction:column;gap:8px;margin:16px 0;">
        <button class="export-option-btn" data-format="json" style="padding:10px 16px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;text-align:left;font-size:13px;color:var(--text-primary);font-family:inherit;">
          <strong>JSON</strong><br><span style="font-size:11px;color:var(--text-tertiary);">Full data — can be re-imported</span>
        </button>
        <button class="export-option-btn" data-format="markdown" style="padding:10px 16px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;text-align:left;font-size:13px;color:var(--text-primary);font-family:inherit;">
          <strong>Markdown</strong><br><span style="font-size:11px;color:var(--text-tertiary);">Readable list with clickable links</span>
        </button>
        <button class="export-option-btn" data-format="bookmarks" style="padding:10px 16px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;cursor:pointer;text-align:left;font-size:13px;color:var(--text-primary);font-family:inherit;">
          <strong>HTML Bookmarks</strong><br><span style="font-size:11px;color:var(--text-tertiary);">Chrome bookmark format</span>
        </button>
      </div>
      <div class="dialog-actions">
        <button class="btn-cancel">${t('cancelButton')}</button>
      </div>
    </div>
  `;

  overlay.querySelectorAll('.export-option-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const format = btn.dataset.format;
      overlay.remove();
      portAPI.send(createRequest(MSG.EXPORT_DATA, { format }));
    });
  });
  overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  document.body.appendChild(overlay);
}

// ---- Clear All Data ----

function handleClearAll() {
  showConfirmDialog(
    t('settingsClearAll'),
    t('settingsClearAllConfirm'),
    async () => {
      // Clear via SW
      portAPI.send(createRequest(MSG.DELETE_WORKSPACE, { workspaceId: '__all__' }));
      // Re-request state
      setTimeout(() => portAPI.send(createRequest(MSG.GET_STATE)), 100);
    }
  );
}

// ---- Toast (re-exported from toast module) ----
export { showToast } from '../lib/toast.js';

// ---- Export Helper ----

function downloadFile(content, filename, mimeType) {
  // Use data URL instead of Blob URL — Blob URLs may not trigger
  // downloads from Chrome extension popups (MV3 sandbox restriction)
  const a = document.createElement('a');
  a.href = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---- Confirm Dialog ----

function showConfirmDialog(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  overlay.innerHTML = `
    <div class="dialog-box">
      <h3>${title}</h3>
      <p>${message}</p>
      <div class="dialog-actions">
        <button class="btn-cancel">${t('cancelButton')}</button>
        <button class="btn-confirm">${t('confirmButton')}</button>
      </div>
    </div>
  `;

  overlay.querySelector('.btn-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('.btn-confirm').addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

// ---- Restore Progress Bar ----

function showRestoreProgress(restored, total) {
  const existing = document.querySelector('.restore-progress');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'restore-progress';
  el.innerHTML = `
    <span>${tn('restoreProgress', restored, total)}</span>
    <div class="progress-bar">
      <div class="progress-fill" style="width: ${(restored / total) * 100}%"></div>
    </div>
  `;

  dom.mainContent.prepend(el);
  restoreInProgress = true;
}

function hideRestoreProgress() {
  const el = document.querySelector('.restore-progress');
  if (el) el.remove();
  restoreInProgress = false;
}

// ---- Review Prompt Banner ----

function showReviewBanner() {
  if (document.getElementById('reviewBanner')) return;

  const banner = document.createElement('div');
  banner.id = 'reviewBanner';
  banner.className = 'review-banner';
  banner.innerHTML = `
    <p class="review-banner-text">${t('reviewBannerTitle')}</p>
    <div class="review-banner-actions">
      <button id="reviewRateBtn" class="review-btn review-btn-primary">${t('reviewBtnRate')}</button>
      <button id="reviewLaterBtn" class="review-btn review-btn-secondary">${t('reviewBtnLater')}</button>
    </div>
  `;

  const toolbar = document.querySelector('.toolbar');
  if (toolbar) {
    dom.app.insertBefore(banner, toolbar);
  } else {
    dom.app.appendChild(banner);
  }

  banner.querySelector('#reviewRateBtn').addEventListener('click', () => {
    chrome.storage.local.set({ tm_review_prompted: true });
    chrome.tabs.create({ url: REVIEW_URL });
    hideReviewBanner();
  });

  banner.querySelector('#reviewLaterBtn').addEventListener('click', () => {
    chrome.storage.local.set({ tm_review_prompted: true });
    hideReviewBanner();
  });
}

function hideReviewBanner() {
  const banner = document.getElementById('reviewBanner');
  if (banner) banner.remove();
}

// ---- Error State ----

function renderError(message) {
  dom.tabListContainer.innerHTML = `
    <div class="empty-state">
      <p>${message}</p>
    </div>
  `;
}

// ---- Boot ----

document.addEventListener('DOMContentLoaded', init);

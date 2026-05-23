// ============================================================
// TabMod — Tab List Component (with virtual scrolling)
//
// Renders the list of saved tabs filtered by workspace and search.
// Supports virtual scrolling for 200+ tabs — only renders visible
// DOM nodes, uses padding to maintain correct scroll height.
// ============================================================

import { MSG, createRequest } from '../lib/messaging.js';
import { tn } from '../lib/i18n.js';
import { matchesQuery, highlightMatch } from './search-bar.js';
import { showToast } from '../lib/toast.js';

let currentPortAPI = null;
const ITEM_HEIGHT = 48;
const BUFFER_ITEMS = 5;
const VIRTUAL_THRESHOLD = 200;

let virtualScrollId = null;

/**
 * Set the port API reference (called from popup.js).
 * @param {object} api
 */
export function setPortAPI(api) {
  currentPortAPI = api;
}

/**
 * Render the tab list.
 * Uses virtual scrolling when tabs > VIRTUAL_THRESHOLD.
 *
 * @param {Array} workspaces
 * @param {string|null} activeWorkspaceId
 * @param {string} searchQuery
 */
export function renderTabList(workspaces, activeWorkspaceId, searchQuery) {
  const container = document.getElementById('tabListContainer');
  if (!container) return;

  // Clean up previous virtual scroll listener
  if (virtualScrollId) {
    container.removeEventListener('scroll', virtualScrollId);
    virtualScrollId = null;
  }

  // Filter and collect tabs
  let filteredWorkspaces = workspaces;
  if (activeWorkspaceId !== null) {
    filteredWorkspaces = workspaces.filter((ws) => ws.id === activeWorkspaceId);
  }

  let allTabs = [];
  for (const ws of filteredWorkspaces) {
    for (const tab of (ws.tabs || [])) {
      allTabs.push({ ...tab, workspaceId: ws.id, workspaceName: ws.name });
    }
  }

  if (searchQuery) {
    allTabs = allTabs.filter(
      (t) => matchesQuery(t.title, searchQuery) || matchesQuery(t.url, searchQuery)
    );
  }

  // ---- Empty state ----
  if (allTabs.length === 0) {
    container.innerHTML = searchQuery
      ? `<div class="empty-state"><p>No tabs matching "${escapeHtml(searchQuery)}"</p></div>`
      : `<div class="empty-state">
          <svg class="empty-icon" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <rect x="8" y="12" width="48" height="40" rx="4" stroke="currentColor" stroke-width="2"/>
            <path d="M8 24h48" stroke="currentColor" stroke-width="2"/>
            <path d="M24 34l8 8 12-12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
          </svg>
          <h2>No saved tabs yet</h2>
          <p>Click the Save All button or press Alt+Shift+A to save all open tabs.</p>
        </div>`;
    return;
  }

  // ---- Decide rendering strategy ----
  const totalHeight = allTabs.length * ITEM_HEIGHT;

  if (allTabs.length <= VIRTUAL_THRESHOLD) {
    // Simple: render all items
    const fragment = document.createDocumentFragment();
    for (const tab of allTabs) {
      fragment.appendChild(createTabElement(tab, searchQuery));
    }
    container.innerHTML = '';
    container.style.paddingTop = '0';
    container.style.paddingBottom = '0';
    container.style.minHeight = 'auto';
    container.appendChild(fragment);
    return;
  }

  // ---- Virtual: render visible items only ----
  container.style.minHeight = `${totalHeight}px`;

  function renderVisible() {
    const scrollTop = container.scrollTop;
    const viewportHeight = container.clientHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER_ITEMS);
    const visibleCount = Math.ceil(viewportHeight / ITEM_HEIGHT) + BUFFER_ITEMS * 2;
    const endIndex = Math.min(allTabs.length, startIndex + visibleCount);

    // Snap to top of visible row to avoid sub-pixel jitter
    const paddingTop = startIndex * ITEM_HEIGHT;
    const paddingBottom = (allTabs.length - endIndex) * ITEM_HEIGHT;

    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i < endIndex; i++) {
      fragment.appendChild(createTabElement(allTabs[i], searchQuery));
    }

    container.innerHTML = '';
    container.style.paddingTop = `${paddingTop}px`;
    container.style.paddingBottom = `${paddingBottom}px`;
    container.appendChild(fragment);
  }

  // Initial render
  renderVisible();

  // Bind scroll listener
  const onScroll = () => {
    // Debounce: coalesce rapid scroll events
    cancelAnimationFrame(virtualScrollId);
    virtualScrollId = requestAnimationFrame(renderVisible);
  };
  container.addEventListener('scroll', onScroll, { passive: true });
  virtualScrollId = onScroll;
}

/**
 * Refresh the tab list (re-fetches from SW).
 */
export function refreshTabList() {
  if (currentPortAPI) {
    currentPortAPI.send(createRequest(MSG.GET_STATE));
  }
}

/**
 * Create a single tab list item element.
 * @param {object} tab
 * @param {string} searchQuery
 * @returns {HTMLElement}
 */
function createTabElement(tab, searchQuery) {
  const item = document.createElement('div');
  item.className = 'tab-item';
  item.dataset.tabId = tab.id;
  item.dataset.workspaceId = tab.workspaceId;
  item.style.minHeight = `${ITEM_HEIGHT}px`;

  // Favicon
  const favicon = document.createElement('img');
  favicon.className = 'favicon';
  favicon.src = tab.favicon || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  favicon.alt = '';
  favicon.loading = 'lazy';
  favicon.onerror = () => { favicon.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'; };
  item.appendChild(favicon);

  // Info
  const info = document.createElement('div');
  info.className = 'tab-info';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || tab.url;
  if (searchQuery) {
    title.innerHTML = highlightMatch(tab.title || tab.url, searchQuery);
  }
  info.appendChild(title);

  const urlEl = document.createElement('div');
  urlEl.className = 'tab-url';
  try {
    urlEl.textContent = new URL(tab.url).hostname;
  } catch {
    urlEl.textContent = tab.url;
  }
  info.appendChild(urlEl);
  item.appendChild(info);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  // Snooze (discard tab to free memory)
  const snoozeBtn = document.createElement('button');
  snoozeBtn.className = 'tab-action-btn snooze-btn';
  snoozeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3 10h8L7 4.5 3 10z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M4 8.5h6" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>
  </svg>`;
  snoozeBtn.setAttribute('aria-label', 'Snooze tab (free memory)');
  snoozeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentPortAPI) {
      currentPortAPI.send(createRequest(MSG.SNOOZE_TAB, { url: tab.url }));
      showToast('Snoozing tab…');
    }
  });
  actions.appendChild(snoozeBtn);

  // Restore
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'tab-action-btn restore-btn';
  restoreBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3 7a4 4 0 118 0 4 4 0 01-8 0z" stroke="currentColor" stroke-width="1.5"/>
    <path d="M7 4.5V7l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
  restoreBtn.setAttribute('aria-label', 'Restore tab');
  restoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentPortAPI) {
      currentPortAPI.send(createRequest(MSG.RESTORE_TAB, {
        workspaceId: tab.workspaceId,
        tabId: tab.id,
      }));
    }
  });
  actions.appendChild(restoreBtn);

  // Delete
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'tab-action-btn delete-btn';
  deleteBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M3 4h8M5.5 4V2.5a.5.5 0 01.5-.5h2a.5.5 0 01.5.5V4M4 4v7.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
  deleteBtn.setAttribute('aria-label', 'Delete tab');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentPortAPI) {
      currentPortAPI.send(createRequest(MSG.DELETE_TAB, {
        workspaceId: tab.workspaceId,
        tabId: tab.id,
      }));
      showToast(tn('tabDeleted', 1), () => {
        if (currentPortAPI) {
          currentPortAPI.send(createRequest(MSG.UNDO_DELETE));
        }
      });
    }
  });
  actions.appendChild(deleteBtn);
  item.appendChild(actions);

  return item;
}

// ---- Helper ----
function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

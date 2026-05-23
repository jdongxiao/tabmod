// ============================================================
// TabMod — Toast Notification Module
//
// Standalone module to break the circular dependency:
//   popup.js  ←  tab-list.js  ←  popup.js
// Now both import from this module instead.
// ============================================================

import { t } from './i18n.js';

const toastContainerId = 'toastContainer';

/**
 * Show a toast notification at the bottom of the popup.
 * @param {string} message - Toast text
 * @param {function} [undoCallback] - Optional callback for "Undo" action
 */
export function showToast(message, undoCallback = null) {
  const container = document.getElementById(toastContainerId);
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;

  if (undoCallback) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'toast-undo';
    undoBtn.textContent = t('undoButton');
    undoBtn.addEventListener('click', () => {
      undoCallback();
      toast.remove();
    });
    toast.appendChild(undoBtn);
  }

  container.innerHTML = '';
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

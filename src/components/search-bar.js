// ============================================================
// TabMod — Search Bar Component
//
// Provides debounced search with query highlighting.
// Used via events — renders nothing by itself.
// ============================================================

let debounceTimer = null;
const DEBOUNCE_MS = 250;

/**
 * Initialize search functionality on an input element.
 * @param {HTMLInputElement} inputEl - The search input element
 * @param {function(string)} onSearch - Callback with the search query
 * @param {object} [options]
 * @param {number} [options.debounceMs=250] - Debounce delay
 * @returns {{ clear: function, destroy: function }}
 */
export function initSearch(inputEl, onSearch, options = {}) {
  const debounceMs = options.debounceMs || DEBOUNCE_MS;

  function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const query = inputEl.value.trim();
      onSearch(query);
    }, debounceMs);
  }

  inputEl.addEventListener('input', handleInput);

  return {
    /**
     * Clear the search input and trigger a reset.
     */
    clear() {
      inputEl.value = '';
      onSearch('');
    },

    /**
     * Remove event listeners.
     */
    destroy() {
      inputEl.removeEventListener('input', handleInput);
      clearTimeout(debounceTimer);
    },
  };
}

/**
 * Highlight matching text in a string.
 * Returns HTML with <mark> tags around matched portions.
 * @param {string} text - The text to search within
 * @param {string} query - The search query
 * @returns {string} HTML with highlighted matches
 */
export function highlightMatch(text, query) {
  if (!query || !text) return escapeHtml(text);

  const escaped = escapeRegex(query);
  const regex = new RegExp(`(${escaped})`, 'gi');
  return escapeHtml(text).replace(regex, '<mark class="highlight">$1</mark>');
}

/**
 * Check if a string matches a search query.
 * @param {string} text
 * @param {string} query
 * @returns {boolean}
 */
export function matchesQuery(text, query) {
  if (!query) return true;
  return text.toLowerCase().includes(query.toLowerCase());
}

// ---- Helpers ----

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

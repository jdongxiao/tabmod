// ============================================================
// TabMod — i18n Helper
//
// Supports runtime language switching by loading messages.json
// files directly via fetch. Falls back to chrome.i18n.getMessage()
// when no custom language is set.
// ============================================================

let messagesCache = null;
let currentLang = null;

/**
 * Map a UI language tag (e.g. "zh-CN", "en-US") onto a locale folder we
 * actually ship ("zh_CN", "en", "ja", "ru"). Chrome's getUILanguage()
 * returns hyphenated tags while _locales folder names use underscores -
 * without this mapping the fetch 404s and every string silently falls
 * back to English.
 * @param {string} lang
 * @returns {string} a locale folder name we ship
 */
function resolveLocale(lang) {
  const SUPPORTED = ['en', 'zh_CN', 'ja', 'ru'];
  const norm = String(lang || '').trim().replace(/-/g, '_');
  if (SUPPORTED.includes(norm)) return norm;
  const ci = SUPPORTED.find((s) => s.toLowerCase() === norm.toLowerCase());
  if (ci) return ci;
  const base = norm.split('_')[0].toLowerCase();
  if (base === 'zh') return 'zh_CN';            // zh_TW / zh_HK / zh_Hans 一律给简体包
  const byBase = SUPPORTED.find((s) => s.split('_')[0] === base);
  return byBase || 'en';
}

/**
 * Load messages for a specific locale.
 * @param {string} lang - Language code (e.g., "en", "zh_CN", "ja")
 * @returns {Promise<object>} Loaded messages object
 */
async function loadMessages(lang) {
  const locale = resolveLocale(lang);
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Not found');
    return await res.json();
  } catch {
    // Fall back to English
    const url = chrome.runtime.getURL('_locales/en/messages.json');
    const res = await fetch(url);
    const data = await res.json();
    return data;
  }
}

/**
 * Initialize i18n with a saved language preference.
 * Call this once at startup (e.g., from popup.js init).
 * @param {string} [lang] - Force a specific language; if omitted, reads from storage
 */
export async function initI18n(lang) {
  if (!lang) {
    const data = await chrome.storage.local.get('settings');
    lang = data?.settings?.language || chrome.i18n.getUILanguage();
  }

  lang = resolveLocale(lang);        // ← normalize "zh-CN" → "zh_CN" before cache key compare

  if (lang === currentLang && messagesCache) return;

  const messages = await loadMessages(lang);
  messagesCache = messages;
  currentLang = lang;
}

/**
 * Get a localized message string.
 * Uses loaded messages if available, falls back to chrome.i18n.getMessage.
 * @param {string} key - Message key from messages.json
 * @param {...(string|number)} args - Optional substitution arguments
 * @returns {string}
 */
export function t(key, ...args) {
  if (!messagesCache) {
    // Fallback to chrome.i18n if cache not ready
    const msg = chrome.i18n.getMessage(key, args.map(String));
    return msg || key;
  }

  const entry = messagesCache[key];
  if (!entry) return key;

  let msg = entry.message;
  if (!args.length) return msg;

  // Substitute $1, $2, etc.
  args.forEach((arg, i) => {
    msg = msg.replace(`$${i + 1}`, String(arg));
  });

  return msg;
}

/**
 * Get a localized message with plural form support.
 * Messages should have _one and _other suffixed keys.
 * @param {string} key - Base message key (without suffix)
 * @param {number} count - Count for plural selection
 * @returns {string}
 */
export function tn(key, count) {
  const pluralKey = count === 1 ? `${key}_one` : `${key}_other`;
  const result = t(pluralKey, count);
  // If plural key wasn't found, try base key
  if (result === pluralKey) return t(key, count);
  return result;
}

/**
 * Get the current UI language from the browser.
 * @returns {string}
 */
export function getUILanguage() {
  return chrome.i18n.getUILanguage();
}

/**
 * Format a timestamp for display in the user's locale.
 * @param {number} timestamp - UTC milliseconds
 * @param {object} [options] - Intl.DateTimeFormat options
 * @returns {string}
 */
export function formatDate(timestamp, options = {}) {
  const defaultOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  };
  return new Intl.DateTimeFormat(getUILanguage(), defaultOptions).format(timestamp);
}

/**
 * Format a number with locale-aware separators.
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  return new Intl.NumberFormat(getUILanguage()).format(n);
}

/**
 * Apply translations to the DOM. Elements carrying data-i18n get their
 * textContent replaced; data-i18n-placeholder / data-i18n-title set those
 * attributes. Idempotent - safe to call more than once.
 * @param {ParentNode} [root=document]
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const msg = t(key);
    if (msg && msg !== key) el.textContent = msg;
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    const msg = t(key);
    if (msg && msg !== key) el.setAttribute('placeholder', msg);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    const msg = t(key);
    if (msg && msg !== key) el.setAttribute('title', msg);
  });
}

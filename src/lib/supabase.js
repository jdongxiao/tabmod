// ============================================================
// TabMod — Lightweight Supabase REST Client
//
// Uses fetch() directly instead of the full supabase-js SDK
// to keep the extension bundle small (~2KB vs ~63KB).
//
// REST API docs: https://supabase.com/docs/reference/api
// ============================================================

const SUPABASE_URL = 'https://tnshfxncodaidnekwajl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRuc2hmeG5jb2RhaWRuZWt3YWpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDc3MzgsImV4cCI6MjA5NDc4MzczOH0.fTTe8ZC33dohPDlkDKdbVF9JwYudg__-7pspy0pW-bA';

const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const REST_URL = `${SUPABASE_URL}/rest/v1`;

// ---- Auth Session ----
let currentSession = null; // { access_token, refresh_token, expires_at }

// ---- Headers ----

function authHeaders(customToken) {
  const token = customToken || currentSession?.access_token;
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
}

// ---- Auth API ----

/**
 * Sign up with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, error: string|null}>}
 */
export async function signUp(email, password) {
  try {
    const res = await fetch(`${AUTH_URL}/signup`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { user: null, error: data.msg || data.error_description || 'Sign up failed' };
    // Auto-confirm might be disabled — user may need to check email
    return { user: data, error: null };
  } catch (err) {
    return { user: null, error: err.message };
  }
}

/**
 * Sign in with email and password.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{session: object|null, error: string|null}>}
 */
export async function signIn(email, password) {
  try {
    const res = await fetch(`${AUTH_URL}/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) return { session: null, error: data.msg || data.error_description || 'Sign in failed' };

    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user,
    };
    currentSession = session;
    // Persist session
    await chrome.storage.local.set({ _supabaseSession: session });
    return { session, error: null };
  } catch (err) {
    return { session: null, error: err.message };
  }
}

/**
 * Sign out — clear session.
 * @returns {Promise<void>}
 */
export async function signOut() {
  if (currentSession?.access_token) {
    try {
      await fetch(`${AUTH_URL}/logout`, {
        method: 'POST',
        headers: authHeaders(),
      });
    } catch (_) { /* ignore */ }
  }
  currentSession = null;
  await chrome.storage.local.remove('_supabaseSession');
}

/**
 * Restore session from storage (called on SW/Popup start).
 * @returns {Promise<{session: object|null}>}
 */
export async function restoreSession() {
  const data = await chrome.storage.local.get('_supabaseSession');
  const saved = data._supabaseSession;
  if (!saved) return { session: null };

  // Check if expired
  if (saved.expires_at && Date.now() > saved.expires_at) {
    // Try to refresh
    const refreshed = await refreshToken(saved.refresh_token);
    if (refreshed.session) return { session: refreshed.session };
    // Refresh failed — clear
    await chrome.storage.local.remove('_supabaseSession');
    return { session: null };
  }

  currentSession = saved;
  return { session: saved };
}

/**
 * Refresh the access token.
 * @param {string} refreshToken
 * @returns {Promise<{session: object|null, error: string|null}>}
 */
async function refreshToken(refreshToken) {
  try {
    const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) return { session: null, error: 'Refresh failed' };

    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user: data.user,
    };
    currentSession = session;
    await chrome.storage.local.set({ _supabaseSession: session });
    return { session, error: null };
  } catch (err) {
    return { session: null, error: err.message };
  }
}

/**
 * Get current user, if logged in.
 * @returns {object|null}
 */
export function getCurrentUser() {
  return currentSession?.user || null;
}

/**
 * Check if user is authenticated.
 * @returns {boolean}
 */
export function isAuthenticated() {
  return !!currentSession?.access_token;
}

// ---- Data API (workspaces) ----

/**
 * Upsert a workspace to Supabase.
 * @param {object} workspace - Local workspace object
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function upsertWorkspace(workspace) {
  if (!isAuthenticated()) return { success: false, error: 'Not authenticated' };
  try {
    const res = await fetch(`${REST_URL}/workspaces`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: currentSession.user.id,
        local_id: workspace.id,
        name: workspace.name,
        icon: workspace.icon || '📁',
        color: workspace.color || '#4A90D9',
        categories: JSON.stringify(workspace.tabs ? [{ name: 'Default', tabs: workspace.tabs }] : []),
        is_deleted: false,
        updated_at: new Date().toISOString(),
      }),
    });
    return { success: res.ok };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Pull workspaces from Supabase.
 * @returns {Promise<{workspaces: Array, error?: string}>}
 */
export async function pullWorkspaces() {
  if (!isAuthenticated()) return { workspaces: [], error: 'Not authenticated' };
  try {
    const res = await fetch(`${REST_URL}/workspaces?select=*&is_deleted=eq.false&order=updated_at.desc`, {
      headers: authHeaders(),
    });
    if (!res.ok) return { workspaces: [], error: 'Pull failed' };
    const data = await res.json();
    // Convert from Supabase format to internal format
    const workspaces = data.map((row) => {
      const cats = typeof row.categories === 'string' ? JSON.parse(row.categories) : (row.categories || []);
      return {
        id: row.local_id,
        name: row.name,
        icon: row.icon || '📁',
        color: row.color || '#4A90D9',
        tabs: cats[0]?.tabs || [],
        createdAt: new Date(row.created_at).getTime(),
        updatedAt: new Date(row.updated_at).getTime(),
      };
    });
    return { workspaces, error: null };
  } catch (err) {
    return { workspaces: [], error: err.message };
  }
}

/**
 * Sync metadata push.
 */
export async function updateSyncMeta(deviceId) {
  if (!isAuthenticated()) return;
  try {
    await fetch(`${REST_URL}/sync_metadata`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        user_id: currentSession.user.id,
        device_id: deviceId,
        last_sync_at: new Date().toISOString(),
      }),
    });
  } catch (_) { /* ignore */ }
}

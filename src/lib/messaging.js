// ============================================================
// TabMod — Messaging Protocol (Popup ↔ Service Worker)
//
// This module is imported by BOTH popup.js and service-worker.js.
// It defines the request/response message types and provides
// helper functions for sending messages over the port.
//
// Protocol:
//   Popup opens → chrome.runtime.connect({ name: 'tabmod' })
//   Popup sends request → { type: 'GET_STATE', payload: {} }
//   SW responds →       → { type: 'STATE_UPDATED', payload: {...} }
//
// Available message types:
//   GET_STATE           → STATE_UPDATED
//   SAVE_ALL            → OPERATION_RESULT
//   SAVE_CURRENT        → OPERATION_RESULT
//   RESTORE_TAB         → OPERATION_RESULT
//   RESTORE_ALL         → RESTORE_PROGRESS / RESTORE_COMPLETE
//   DELETE_TAB          → OPERATION_RESULT
//   DELETE_WORKSPACE    → OPERATION_RESULT
//   UNDO_DELETE         → OPERATION_RESULT
//   RENAME_WORKSPACE    → OPERATION_RESULT
//   UPDATE_SETTINGS     → OPERATION_RESULT
//   GET_STATS           → STATS_RESULT
//   EXPORT_DATA         → EXPORT_RESULT
//   ACTIVATE_LICENSE    → OPERATION_RESULT
// ============================================================

// ---- Message Types ----

export const MSG = {
  // Requests (Popup → SW)
  GET_STATE: 'GET_STATE',
  SAVE_ALL: 'SAVE_ALL',
  SAVE_CURRENT: 'SAVE_CURRENT',
  RESTORE_TAB: 'RESTORE_TAB',
  RESTORE_ALL: 'RESTORE_ALL',
  DELETE_TAB: 'DELETE_TAB',
  DELETE_WORKSPACE: 'DELETE_WORKSPACE',
  UNDO_DELETE: 'UNDO_DELETE',
  CREATE_WORKSPACE: 'CREATE_WORKSPACE',
  RENAME_WORKSPACE: 'RENAME_WORKSPACE',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_STATS: 'GET_STATS',
  EXPORT_DATA: 'EXPORT_DATA',
  ACTIVATE_LICENSE: 'ACTIVATE_LICENSE',
  SNOOZE_TAB: 'SNOOZE_TAB',
  UNSNOOZE_TAB: 'UNSNOOZE_TAB',

  // Responses (SW → Popup)
  STATE_UPDATED: 'STATE_UPDATED',
  OPERATION_RESULT: 'OPERATION_RESULT',
  RESTORE_PROGRESS: 'RESTORE_PROGRESS',
  RESTORE_COMPLETE: 'RESTORE_COMPLETE',
  STATS_RESULT: 'STATS_RESULT',
  EXPORT_RESULT: 'EXPORT_RESULT',
};

/**
 * Create a request message object.
 * @param {string} type - Message type constant
 * @param {object} [payload] - Optional payload
 * @returns {object}
 */
export function createRequest(type, payload = {}) {
  return { type, payload };
}

/**
 * Create a success response.
 * @param {object} [payload] - Response data
 * @returns {{ success: true, payload?: object }}
 */
export function success(payload = {}) {
  return { success: true, ...payload };
}

/**
 * Create an error response.
 * @param {string} error - Error message
 * @returns {{ success: false, error: string }}
 */
export function error(error) {
  return { success: false, error };
}

// ---- Popup-side: Port Connection ----

const PORT_NAME = 'tabmod';
let port = null;
let messageQueue = [];
let listeners = {};

/**
 * Connect to the Service Worker via a long-lived port.
 * Automatically reconnects if the port disconnects.
 * @param {function} onMessage - Callback for incoming messages
 * @returns {{ send: function, disconnect: function }}
 */
export function connectToSW(onMessage) {
  if (port) {
    // Already connected, just return the API
    return createPortAPI(onMessage);
  }

  try {
    port = chrome.runtime.connect({ name: PORT_NAME });
  } catch (e) {
    console.error('[TabMod Messaging] Failed to connect:', e);
    return null;
  }

  port.onMessage.addListener((msg) => {
    if (onMessage) onMessage(msg);
    // Also dispatch to registered type listeners
    if (msg.type && listeners[msg.type]) {
      listeners[msg.type].forEach((fn) => fn(msg.payload || msg));
    }
  });

  port.onDisconnect.addListener(() => {
    const lastError = chrome.runtime.lastError;
    if (lastError && lastError.message?.includes('Extension context invalidated')) {
      // Extension was updated or reloaded — can't reconnect
      port = null;
      if (onMessage) {
        onMessage({ type: MSG.OPERATION_RESULT, payload: { success: false, error: 'extension_reloaded' } });
      }
      return;
    }
    // Normal disconnect (popup closing or SW terminating)
    port = null;
  });

  // Flush queued messages
  const api = createPortAPI(onMessage);
  if (messageQueue.length > 0) {
    messageQueue.forEach((msg) => api.send(msg));
    messageQueue = [];
  }

  return api;
}

/**
 * Register a listener for a specific message type.
 * @param {string} type - Message type constant
 * @param {function} callback
 */
export function onMessage(type, callback) {
  if (!listeners[type]) listeners[type] = [];
  listeners[type].push(callback);
}

/**
 * Remove a listener for a specific message type.
 * @param {string} type
 * @param {function} callback
 */
export function offMessage(type, callback) {
  if (!listeners[type]) return;
  listeners[type] = listeners[type].filter((fn) => fn !== callback);
}

function createPortAPI(onMessage) {
  return {
    /**
     * Send a message to the SW.
     * @param {object} msg - Message object with type and payload
     */
    send(msg) {
      if (!port) {
        // Queue for when connection is established
        messageQueue.push(msg);
        return;
      }
      try {
        port.postMessage(msg);
      } catch (e) {
        console.error('[TabMod Messaging] Send error:', e);
      }
    },

    /**
     * Disconnect the port.
     */
    disconnect() {
      if (port) {
        try { port.disconnect(); } catch (_) {}
        port = null;
      }
      listeners = {};
      messageQueue = [];
    },
  };
}

// ---- SW-side: Connection Handler ----

/**
 * Handle an incoming port connection from the Popup.
 * To be called in the SW: chrome.runtime.onConnect.addListener(handlePopupConnection)
 * @param {chrome.runtime.Port} incomingPort
 * @param {object} handlers - Object mapping message types to handler functions
 */
export function handlePopupConnection(incomingPort, handlers) {
  if (incomingPort.name !== PORT_NAME) return;

  incomingPort.onMessage.addListener(async (msg) => {
    const handler = handlers[msg.type];
    if (handler) {
      try {
        const result = await handler(msg.payload);
        incomingPort.postMessage({
          type: getResponseType(msg.type),
          payload: result,
        });
      } catch (err) {
        incomingPort.postMessage({
          type: MSG.OPERATION_RESULT,
          payload: { success: false, error: err.message || 'Unknown error' },
        });
      }
    } else {
      incomingPort.postMessage({
        type: MSG.OPERATION_RESULT,
        payload: { success: false, error: `Unknown message type: ${msg.type}` },
      });
    }
  });

  incomingPort.onDisconnect.addListener(() => {
    // Cleanup if needed
  });
}

function getResponseType(requestType) {
  const map = {
    [MSG.GET_STATE]: MSG.STATE_UPDATED,
    [MSG.GET_STATS]: MSG.STATS_RESULT,
    [MSG.EXPORT_DATA]: MSG.EXPORT_RESULT,
  };
  return map[requestType] || MSG.OPERATION_RESULT;
}

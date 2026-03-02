// AppState — Observable state container with pub/sub
// ES module. This is the Model in MVVM — holds all dashboard data and notifies
// subscribers on changes.

/**
 * Create an observable application state container.
 * Provides get/set/update/subscribe/getSnapshot for centralized state management.
 *
 * @param {object} initialState — initial state shape
 * @returns {{ get, set, update, subscribe, getSnapshot }}
 */
export function createAppState(initialState) {
  var state = {};
  for (var k in initialState) state[k] = initialState[k];
  var listeners = [];

  return {
    /**
     * Get a single state value by key.
     * @param {string} key
     * @returns {*}
     */
    get: function (key) { return state[key]; },

    /**
     * Set a single state value and notify subscribers.
     * @param {string} key
     * @param {*} value
     */
    set: function (key, value) {
      state[key] = value;
      notify({ [key]: value });
    },

    /**
     * Batch update multiple state keys, then notify subscribers once.
     * @param {object} partial — map of key/value pairs to merge into state
     */
    update: function (partial) {
      for (var k in partial) state[k] = partial[k];
      notify(partial);
    },

    /**
     * Register a listener that fires on every state change.
     * @param {Function} fn — callback(changedKeys, fullState)
     * @returns {Function} unsubscribe function
     */
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (l) { return l !== fn; });
      };
    },

    /**
     * Return a shallow copy of the full state.
     * @returns {object}
     */
    getSnapshot: function () {
      var copy = {};
      for (var k in state) copy[k] = state[k];
      return copy;
    },
  };

  function notify(changed) {
    for (var i = 0; i < listeners.length; i++) {
      listeners[i](changed, state);
    }
  }
}

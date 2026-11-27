/*
 * zhihu_web - local settings and reading history.
 * Everything stays on this machine (localStorage), nothing is uploaded.
 */
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'zw.settings.v1';
  var HISTORY_KEY = 'zw.history.v1';
  var HISTORY_LIMIT = 60;

  var DEFAULTS = {
    theme: 'auto',        // auto | light | dark
    fontSize: 17,         // reader body size in px
    images: true,         // load pictures in articles
    expandAnswers: true,  // show full answer text in question view
    answerLimit: 5
  };

  function readJson(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) {
        return fallback;
      }
      var value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Quota or private mode: settings simply do not persist.
    }
  }

  var settings = readJson(SETTINGS_KEY, {});
  for (var key in DEFAULTS) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) && typeof settings[key] === 'undefined') {
      settings[key] = DEFAULTS[key];
    }
  }

  function emit(name, detail) {
    try {
      global.dispatchEvent(new CustomEvent('zw:' + name, { detail: detail }));
    } catch (error) {
      // Older engines without CustomEvent constructors.
    }
  }

  global.ZW = global.ZW || {};
  global.ZW.store = {
    defaults: DEFAULTS,

    settings: function () {
      return settings;
    },

    set: function (name, value) {
      settings[name] = value;
      writeJson(SETTINGS_KEY, settings);
      emit('settings', { name: name, value: value });
    },

    history: function () {
      return readJson(HISTORY_KEY, []);
    },

    visit: function (entry) {
      if (!entry || !entry.title) {
        return;
      }
      var list = readJson(HISTORY_KEY, []);
      var key = entry.route || entry.title;
      list = list.filter(function (item) {
        return (item.route || item.title) !== key;
      });
      list.unshift({
        route: entry.route || '',
        title: entry.title,
        kind: entry.kind || '问题',
        at: Date.now()
      });
      writeJson(HISTORY_KEY, list.slice(0, HISTORY_LIMIT));
      emit('history', null);
    },

    clearHistory: function () {
      writeJson(HISTORY_KEY, []);
      emit('history', null);
    }
  };
})(window);

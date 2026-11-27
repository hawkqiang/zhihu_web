/*
 * zhihu_web - host bridge.
 *
 * The product logic only ever talks to this object. Whatever runs the web
 * assets (WebView2 today, Android WebView or WebKitGTK later, a plain browser
 * for development) implements the same small surface:
 *
 *   info()                    -> { app, version, host, runtime, dataDir, ... }
 *   request({url, headers})   -> { status, headers, text }
 *   cookies(url)              -> { cookie, count }
 *   clearCookies()
 *   login()                   -> { signedIn, cookie }
 *   openExternal(url)
 *   openPage(url)             -> native window showing the real page
 *   setTitle(text)  copyText(text)  metric(name, value)  quit()
 *
 * On Windows the implementation is a JSON message channel to the C# shell
 * (see src/desktop-win/Bridge.cs). In a plain browser the fallback uses fetch
 * and window.open, which keeps the UI usable for layout work even though
 * cross-origin API calls will be blocked by CORS.
 */
(function (global) {
  'use strict';

  var BROWSER_KIND = 'browser';

  function makeChannel(post, subscribe) {
    var pending = new Map();
    var seq = 0;

    subscribe(function (message) {
      if (!message || typeof message !== 'object') {
        return;
      }
      var entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      if (message.ok) {
        entry.resolve(message.result);
      } else {
        entry.reject(new Error(message.error || '宿主调用失败'));
      }
    });

    return function call(method, params, timeoutMs) {
      seq += 1;
      var id = 'c' + seq;
      return new Promise(function (resolve, reject) {
        var timer = timeoutMs === 0 ? null : global.setTimeout(function () {
          pending.delete(id);
          reject(new Error('宿主无响应: ' + method));
        }, timeoutMs || 30000);
        pending.set(id, {
          resolve: function (value) {
            global.clearTimeout(timer);
            resolve(value);
          },
          reject: function (error) {
            global.clearTimeout(timer);
            reject(error);
          }
        });
        post({ id: id, method: method, params: params || {} });
      });
    };
  }

  function webview2Host(webview) {
    var call = makeChannel(
      function (payload) { webview.postMessage(payload); },
      function (handler) { webview.addEventListener('message', function (event) { handler(event.data); }); }
    );

    return {
      kind: 'webview2',
      native: true,
      api: true,
      call: call,
      info: function () { return call('host.info'); },
      request: function (options) { return call('http.request', options, 25000); },
      cookies: function (url) { return call('session.cookies', { url: url }); },
      clearCookies: function () { return call('session.clear'); },
      login: function () { return call('shell.login', {}, 0); },
      openExternal: function (url) { return call('shell.openExternal', { url: url }); },
      openPage: function (url) { return call('shell.openPage', { url: url }); },
      setTitle: function (text) { return call('shell.setTitle', { title: text }); },
      copyText: function (text) { return call('shell.copyText', { text: text }); },
      metric: function (name, value) { return call('shell.metric', { name: name, value: value }); },
      openDataFolder: function () { return call('shell.openDataFolder'); },
      quit: function () { return call('shell.quit'); }
    };
  }

  function browserHost() {
    return {
      kind: BROWSER_KIND,
      native: false,
      api: false,
      info: function () {
        return Promise.resolve({
          app: 'zhihu_web',
          version: 'dev',
          host: 'browser',
          runtime: navigator.userAgent,
          dataDir: ''
        });
      },
      request: function (options) {
        return fetch(options.url, {
          method: options.method || 'GET',
          headers: options.headers || {},
          credentials: 'include'
        }).then(function (response) {
          return response.text().then(function (text) {
            var headers = {};
            response.headers.forEach(function (value, name) { headers[name] = value; });
            return { status: response.status, headers: headers, text: text };
          });
        });
      },
      cookies: function () {
        return Promise.resolve({ cookie: document.cookie, count: document.cookie ? document.cookie.split(';').length : 0 });
      },
      clearCookies: function () { return Promise.resolve({ ok: true }); },
      login: function () {
        return Promise.reject(new Error('浏览器预览模式无法完成登录，请在 zhihu_web 桌面端登录'));
      },
      openExternal: function (url) { global.open(url, '_blank', 'noopener'); return Promise.resolve({ ok: true }); },
      openPage: function (url) { global.open(url, '_blank', 'noopener'); return Promise.resolve({ ok: true }); },
      setTitle: function (text) { document.title = text; return Promise.resolve({ ok: true }); },
      copyText: function (text) {
        return navigator.clipboard.writeText(text).then(function () { return { ok: true }; });
      },
      metric: function () { return Promise.resolve({ ok: true }); },
      openDataFolder: function () { return Promise.resolve({ ok: true }); },
      quit: function () { return Promise.resolve({ ok: true }); }
    };
  }

  var host = (global.chrome && global.chrome.webview) ? webview2Host(global.chrome.webview) : browserHost();

  global.ZW = global.ZW || {};
  global.ZW.host = host;
})(window);

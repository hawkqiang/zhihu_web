# Architecture & Portability

`zhihu_web` separates portable web product logic (`src/web/`) from the thin OS
host (`src/desktop-win/`).

```text
+-------------------------------------------------------------------+
|  src/web/ (Plain HTML / CSS / Vanilla JS - 100% OS-agnostic)      |
|  index.html, app.css, app.js, render.js, api.js, zse96.js, store  |
+---------------------------------+---------------------------------+
                                  |
                        ZW.host bridge contract
                       (src/web/js/host.js)
                                  |
      +---------------------------+---------------------------+
      |                           |                           |
      v                           v                           v
[Windows today]            [Linux future]             [Android future]
WebView2 Evergreen         WebKitGTK / WebView        android.webkit.WebView
src/desktop-win/Bridge.cs  GTK/Vala/C/Python host     Kotlin/Java host
```

## 1. Host Bridge Contract (`window.ZW.host`)

Frontend modules (`app.js`, `api.js`, `render.js`, `store.js`) never import or
assume Windows APIs. Every host interaction goes through `ZW.host` in
`src/web/js/host.js`, exchanging JSON payloads `{ id, method, params }` ->
`{ id, ok, result | error }`:

| Method | Purpose | Windows Implementation (`Bridge.cs`) |
|---|---|---|
| `host.info` | App version, host kind, runtime version, data dir | `CoreWebView2Environment` + `AppPaths` |
| `http.request` | CORS-free HTTPS requests with explicit headers/cookies | `System.Net.Http.HttpClient` (`UseCookies = false`) |
| `session.cookies` | Read Zhihu domain cookies (`d_c0`, `z_c0`, `_xsrf`) | `core.CookieManager.GetCookiesAsync(url)` |
| `session.clear` | Sign out by clearing host WebView cookies | `core.CookieManager.DeleteAllCookies()` |
| `shell.login` | Open Zhihu sign-in page in shared WebView session | `LoginWindow` polling for `z_c0` cookie |
| `shell.openPage` | Open full Zhihu webpage inside embedded child WebView | `ReaderWindow` sharing `WebEnv` |
| `shell.openExternal` | Open third-party `http(s)` links in default browser | `Process.Start(UseShellExecute = true)` |
| `shell.setTitle` | Update native window title | `ShellForm.SetWebTitle` |
| `shell.metric` | Append local startup/load metrics | Append JSONL line to `metrics.jsonl` |
| `shell.openDataFolder` | Open local data directory in file manager | `explorer.exe` |
| `shell.copyText` | Copy text to OS clipboard | `Clipboard.SetText` |
| `shell.quit` | Exit application | `ShellForm.Close()` |

When opened in a standard browser (Edge / Chrome / Edge PWA preview) without a
native host, `host.js` falls back to `browserHost()` automatically so layout
and UI logic can still be developed directly.

## 2. Why `x-zse-96` Lives in `src/web/js/`

`md5.js` and `zse96.js` are written in standard ES5/ES6 JavaScript using only
`Uint8Array`, `Int32Array`, `DataView`, and `TextEncoder`. Keeping request
signing in the web layer means future Android, Linux, or Windows ARM64 hosts
only need to implement the 12-method bridge above and do **not** have to
re-implement MD5/SM4 signing in Kotlin, C, or C#.

## 3. Target Platform Compatibility

- **Windows x64 / x86**: Supported today via `tools\build.ps1 -Arch x64|x86`.
- **Windows ARM64**: `lib\webview2\loader\arm64\WebView2Loader.dll` is already
  vendored, and `tools\build.ps1 -Arch arm64` compiles an ARM64 binary using
  `.NET Framework` (or AnyCPU/ARM64 on Windows ARM64).
- **Android**: Wrap `src/web/` in `WebViewAssetLoader` + `@JavascriptInterface`
  exposing the `ZW.host` methods and `CookieManager`.
- **Linux**: Wrap `src/web/` in `WebKitWebView` (WebKitGTK) with a custom URI
  scheme (`app://` or `https://zhihu-web.local/`) and `UserContentManager`
  script message handler implementing the same JSON RPC methods.

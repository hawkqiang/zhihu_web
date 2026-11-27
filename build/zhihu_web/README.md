# zhihu_web

A small, local-first Zhihu reader for Windows built with the system's Microsoft
Edge **WebView2 Evergreen Runtime**. The shell is WinForms on .NET Framework
4.8; the reader itself is plain HTML, CSS, and vanilla JavaScript. No Electron,
no bundled browser engine, no cloud service and no Node.js runtime are required.

> **Unofficial project**: zhihu_web is not affiliated with Zhihu. It uses
> undocumented Zhihu endpoints; a server-side change can break one or more
> features at any time. See [NOTICE.md](NOTICE.md) for upstream and license
> attribution.

## Features in this first vertical slice

- **Hot list**: uses Zhihu's public guest web feed.
- **Recommendations**: uses the public Zhihu guest feed.
- **Search, full questions, answers, articles, and follow feed**: currently
  require a signed-in WebView2 session; if the service denies a request, the UI
  offers login / opening Zhihu in the embedded WebView.
- **In-app Zhihu sign-in**: performed only on Zhihu's own sign-in page. Passwords
  are never read by this app; cookies stay in the local WebView2 profile.
- **Reading history, font size, image toggle, theme, window size**: local-only.
- **Safe rich text**: an HTML allowlist sanitizer removes scripts, styles,
  event handlers, embedded forms, and unsafe URLs before displaying answer text.
- **Keyboard**: `Ctrl+F` searches, `Esc` blurs the field, `Alt+Left` goes back.
- **Fallback**: arbitrary pages open in one child WebView2 window; external links
  open in the default browser.

## Build & run

### Requirements

- Windows 10/11, x64 / x86 / ARM64 (the build architecture must match the
  machine and selected WebView2 loader).
- .NET Framework 4.8 or newer.
- Microsoft Edge WebView2 Evergreen Runtime. This is system software; it is not
  part of the application package. Windows 11 and most managed Windows 10
  deployments already have it. If missing, install the official Evergreen
  Runtime from <https://developer.microsoft.com/microsoft-edge/webview2/>.
- A C# compiler shipped with .NET Framework (provided by Windows / .NET
  Framework 4.x). The project does not require `dotnet` SDK, Visual Studio,
  Node.js, a package manager, or a build server.

### Build

Open PowerShell in this project folder:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build.ps1
```

Outputs to `build\zhihu_web\`. Build variants:

```powershell
.\tools\build.ps1 -Arch x86
.\tools\build.ps1 -Arch arm64
.\tools\build.ps1 -Clean
```

### Run

```powershell
.\tools\run.ps1
```

Or double-click `build\zhihu_web\zhihu_web.exe`.

Use a workspace-relative data folder (portable / sandbox mode) by creating an
empty file named `zhihu_web.portable` beside the executable. To use another
location, set `ZHIHU_WEB_DATA` before launching:

```powershell
$env:ZHIHU_WEB_DATA = "$env:LOCALAPPDATA\zhihu_web\data"
.\tools\run.ps1
```

### Diagnose API access

This opens a WebView2 window, loads Zhihu, runs the reader's JavaScript
signature against five candidate endpoints, and writes a JSON report to the
local data directory. It includes no cookie values or credentials:

```powershell
.\tools\run.ps1 -Diagnose
```

If run by an automated sandbox, the report falls back to
`build\zhihu_web\data\diagnose.json` when the default user profile is read-only.

## Data and privacy

- WebView2's user data folder: `%LOCALAPPDATA%\zhihu_web\data\WebView2`.
- Window settings, app logs, metrics: `%LOCALAPPDATA%\zhihu_web\data\`.
- Reading history, theme, and reader settings: WebView2 `localStorage`.
- Cookies are held by WebView2 and are used only for requests to Zhihu.
- No analytics SDK, telemetry endpoint, crash service, or remote storage is
  integrated. `metrics.jsonl` stores only local app metrics (e.g. startup time).
- You can clear reading history in Settings. Clear the full login and profile
  data by closing the app and removing `WebView2` from the local data folder.

## Architecture

```text
src/web/                 static UI and business rules (portable)
  js/host.js             OS bridge contract + browser-preview fallback
  js/api.js              small endpoint subset + request signing
  js/zse96.js            pure JS port of upstream signature logic
src/desktop-win/         thin Windows WebView2 host
  Bridge.cs              the only Windows-specific JS/OS seam
  ShellForm.cs           main window + navigation policy
  LoginWindow.cs         official Zhihu sign-in page in a shared profile
  DiagnosticsForm.cs     endpoint + signature diagnostic
lib/webview2/            small WebView2 SDK assemblies and native loader only
tools/                   build and detached run scripts
docs/                    design, limitations, measurements, troubleshooting
```

## Limitations

- The app uses endpoints that Zhihu may change without notice.
- Guest feed access works independently of login; other features depend on
  Zhihu's current anti-abuse and login policies. Some items (especially answers)
  may legitimately require login or manual human verification.
- Zhihu may restrict or rate-limit accounts. This app does not bypass captchas,
  anti-abuse, paywalls, or account controls. If asked, complete verification in
  the embedded official page, then return and retry.
- Desktop interactions (vote, comment, publish, notifications) are not yet
  implemented. Use the embedded Zhihu page when the reader is not enough.
- API responses may include third-party HTML; displayed content is sanitized
  but no sanitizer can protect against every future WebView/browser defect.

## Licence

GPL-3.0, see [LICENSE](LICENSE).

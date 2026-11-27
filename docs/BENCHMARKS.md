# Benchmarks & Footprint (`zhihu_web`)

All numbers below were measured on the target Windows host (`Windows NT 10.0.26300.0`,
x64, .NET Framework `4.8.1`, Microsoft Edge WebView2 Evergreen Runtime
`158.0.4370.45`) using `tools\measure.ps1` after a clean x64 build.

## 1. Startup Speed

| Milestone | Measured (cold profile) | How measured |
|---|---|---|
| Process start -> WebView2 runtime ready | ~1.11 s (`1114 ms`) | `app.log` timestamp delta (`start` -> `webview2 runtime=...`) |
| Process start -> virtual host `index.html` navigated | ~1.54 s (`1542 ms`) | `app.log` (`navigation completed ok=True http=200`) |
| Web page boot -> live Hot List rendered | `1218 ms` | `performance.now()` inside WebView2 (`hot-loaded` / `first-render`) |
| Total cold start -> live Zhihu Hot List on screen | `2.36 s` (`2359 ms`) | `Stopwatch` in `Program.cs` (`startupMs` in `metrics.jsonl`) |

Note: the cold-profile measurement starts from an empty `WebView2` user-data
directory and includes live HTTPS requests to `api.zhihu.com` for 30 hot-list
entries.

## 2. Memory Usage (Live Hot List Loaded)

| Process Group | Working Set | Private Memory |
|---|---|---|
| Host process (`zhihu_web.exe`, WinForms/.NET 4.8) | `54.86 MB` | `29.74 MB` |
| System WebView2 child processes (6 × `msedgewebview2.exe`) | `385.89 MB` | `200.46 MB` |
| **Combined total** | **`440.75 MB`** | **`230.20 MB`** |

Because WebView2 Evergreen Runtime shares Edge binaries and system memory pages
with Microsoft Edge when Edge is already active on Windows, incremental memory
cost is substantially lower than bundling a private Chromium runtime (Electron
typically ships 120–180 MB of duplicated binaries and runs a separate Chromium
stack).

## 3. CPU Usage

| Phase | CPU Time | Notes |
|---|---|---|
| Initial startup + WebView2 init (`zhihu_web.exe`) | `0.906 s` | One-time WinForms + COM activation |
| Initial startup + Hot List load (6 × `msedgewebview2.exe`) | `5.781 s` | First-time `EBWebView` profile creation + render |
| **Steady-state idle (3-second window after load)** | **`0.000 s` (`0.00%` of 1 core)** | No background polling, no telemetry loop, no React reconciler |

## 4. Disk Footprint

| Artifact | Size | Notes |
|---|---|---|
| Compiled executable (`zhihu_web.exe`) | `50.0 KB` (`51,200 B`) | C# 5 compiled with in-box `.NET Framework` `csc.exe` |
| Web frontend (`src/web/`: HTML + CSS + JS + SVG + manifest) | `96.0 KB` (`98,301 B`) | Unbundled, zero `node_modules` |
| Vendored WebView2 managed + native loader (`x64`) | `915.5 KB` | `Core.dll` + `WinForms.dll` + `WebView2Loader.dll` |
| **Total distributable folder (`build\zhihu_web\`)** | **`1.08 MB`** | Ready to run; includes `LICENSE`, `NOTICE.md`, `README.md` |
| Cold runtime profile (`WebView2\EBWebView` on first run) | `10.62 MB` | Created in `%LOCALAPPDATA%\zhihu_web\data\WebView2` |
| Bundled browser engine | `0 MB` | Reuses system WebView2 Evergreen Runtime |

## 5. Maintenance Cost

| Dimension | `zhihu_web` | Typical Electron / RN-Windows Alternative |
|---|---|---|
| Frontend source size | `3,347` lines across 9 files (`HTML/CSS/JS`) | Framework + bundler + state + bridge boilerplate |
| Native host source size | `1,309` lines across 8 `.cs` files | Native modules + C++/WinRT + Gradle/MSVC toolchains |
| Build dependencies | **0** external tools (`csc.exe` ships with Windows) | Node.js + npm/pnpm + Electron/Expo + VC++ / .NET SDK |
| `node_modules` packages | **0** | Hundreds to thousands of transitive packages |
| Build time (`tools\build.ps1 -Clean`) | **~1 second** | Minutes |
| Browser security patches | Handled automatically by Windows Edge WebView2 Evergreen | Requires rebuilding and shipping new app binaries |

# Status & Verified Behaviour

## Build Environment

The workspace had no installed .NET SDK and no Node.js on `PATH`; the DSH
bundled Node runtime was used only for static syntax checks and crypto tests.
The machine has .NET Framework 4.8.1 (`Release=534296`), the in-box C# 5
compiler (`csc.exe`), and Microsoft Edge WebView2 Evergreen Runtime
`158.0.4370.45`.

The project compiles offline in ~1 second via `tools/build.ps1` (`/langversion:5`,
targeting `x64` by default, with `x86` and `arm64` WebView2 loaders vendored).

## Upstream API Investigation (2026-11-27)

Source basis: [`zhihu-minus-minus`](https://github.com/huamurui/zhihu-minus-minus)
(v0.10.1; GPL-3.0). Its README explicitly states that it relies on undocumented
Zhihu interfaces whose behaviour can change. Its `x-zse-96` request-signing
algorithm (`zse_purity.ts`) was ported to pure JavaScript (`src/web/js/zse96.js`
and `src/web/js/md5.js`).

Live probes were executed in both standalone Node `fetch` and the real WebView2
runtime (`zhihu_web.exe --diagnose`):

| Endpoint / Flow | Observed Behaviour | App Behaviour |
|---|---|---|
| `https://api.zhihu.com/topstory/hot-list?limit=50` | HTTP 200 in guest mode, 30 `hot_list_feed` items | Primary Hot List feed (verified visually in app) |
| `https://api.zhihu.com/topstory/recommend?...` | HTTP 200 in guest mode, `data` + `dataV1` answer items with full `content` | Primary guest Recommend feed; falls back to `/api/v3/explore/guest/feeds` |
| `https://www.zhihu.com/api/v3/explore/guest/feeds?limit=15` | HTTP 200 in guest mode, 10–15 full answers | Guest fallback for Recommend feed; answer bodies cached locally on click |
| `https://www.zhihu.com/api/v3/feed/topstory/recommend` | HTTP 401 when unauthenticated | Used when signed in (`z_c0` present) |
| `https://www.zhihu.com/api/v3/moments` | Requires signed-in cookie | Used when signed in; guest view prompts sign-in |
| `https://www.zhihu.com/api/v4/search_v3` | HTTP 401 `ZERR_NOT_LOGIN` in guest mode | Uses signed-in cookie; offers one-click login or embedded browser search |
| `https://www.zhihu.com/api/v4/questions/{id}/answers` | HTTP 403 / 40362 in guest mode | Uses signed-in cookie; otherwise offers login or embedded `ReaderWindow` |
| `https://www.zhihu.com/api/v4/me` | HTTP 401 when unauthenticated | Used after WebView2 login to display user name/avatar |

## Verification Matrix

- `node --check` on all 7 files in `src/web/js/`: **PASS**.
- `md5.js` against Node `crypto.createHash('md5')` (empty, ASCII, signing
  payload, UTF-8 Chinese, 1 KB): **PASS**.
- `zse96.js` output (`2.0_` prefix, alphabet, repeatability) + injection inside
  live WebView2 `--diagnose`: **PASS**.
- `tools\build.ps1 -Clean` (`x64`): **PASS** (`1.08 MB` total output).
- Live WebView2 GUI run + screenshot inspection (`tools\measure.ps1`): **PASS**
  - Window renders sidebar (`知乎-- WEB`, 热榜 / 推荐 / 关注 / 历史 / 设置 / 登录),
    top search bar, theme toggle, embedded browser button, and live Hot List cards.
  - Startup to live Hot List: `2.36 s` (`2359 ms`); idle CPU: `0.00%`; host
    working set: `54.86 MB`.
  - See [BENCHMARKS.md](BENCHMARKS.md) for complete measurements.

## Remaining Limitations

1. Some Zhihu detail/search endpoints require a signed-in `z_c0` cookie or
   human verification on Zhihu's side; the reader explicitly exposes Login and
   Embedded Browser fallbacks rather than attempting to bypass anti-crawl checks.
2. Write actions (upvoting, commenting, publishing) are intentionally omitted
   in this lightweight reader slice; use the embedded Zhihu window when needed.
3. Authenticated endpoints (`following`, `search`, `me`, signed `answers`) should
   be re-tested manually after signing in via the in-app Login window.

using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace ZhihuWeb
{
    /// <summary>
    /// One WebView2 environment (one user data folder) shared by every window of
    /// the app, so the cookie jar and the browser process are reused.
    /// </summary>
    internal static class WebEnv
    {
        private static readonly object Sync = new object();
        private static CoreWebView2Environment cached;
        private static Task<CoreWebView2Environment> pending;

        internal const string BrowserArguments =
            "--disable-web-security --allow-running-insecure-content --disable-features=msEdgeSidebarV2,msWebOOUI,msPdfOOUI,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure --no-first-run --no-default-browser-check";

        internal static Task<CoreWebView2Environment> GetAsync()
        {
            lock (Sync)
            {
                if (cached != null)
                {
                    return Task.FromResult(cached);
                }
                if (pending == null)
                {
                    pending = CreateAsync();
                }
                return pending;
            }
        }

        private static async Task<CoreWebView2Environment> CreateAsync()
        {
            Directory.CreateDirectory(AppPaths.WebView2DataDir);
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions();
            options.AdditionalBrowserArguments = BrowserArguments;
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(
                null, AppPaths.WebView2DataDir, options);
            lock (Sync)
            {
                cached = environment;
            }
            return environment;
        }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace ZhihuWeb
{
    /// <summary>
    /// The single seam between the web UI and Windows.
    ///
    /// Front-end code never talks to Win32, the registry or the file system.
    /// It posts { id, method, params } JSON messages and this class answers with
    /// { id, ok, result } / { id, ok:false, error }. Porting the shell to
    /// another WebView host (Android WebView, WebKitGTK, ...) means
    /// re-implementing only this contract, not the product logic.
    /// </summary>
    internal sealed class Bridge
    {
        private static readonly HttpClient Http = CreateHttpClient();
        private readonly CoreWebView2 core;
        private readonly ShellForm shell;

        internal Bridge(CoreWebView2 core, ShellForm shell)
        {
            this.core = core;
            this.shell = shell;
        }

        private static HttpClient CreateHttpClient()
        {
            // Zhihu serves gzip/deflate; Brotli is not wired up by in-box
            // .NET Framework's HttpClient, so the UI never advertises it.
            // The in-box compiler targets an older Framework by default. Do not
            // inherit its legacy TLS defaults: let Windows negotiate the protocol.
            ServicePointManager.SecurityProtocol = SecurityProtocolType.SystemDefault;
            HttpClientHandler handler = new HttpClientHandler();
            handler.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
            handler.AllowAutoRedirect = true;
            handler.UseCookies = false;
            HttpClient client = new HttpClient(handler);
            client.Timeout = TimeSpan.FromSeconds(20);
            return client;
        }

        internal async void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw = e.WebMessageAsJson;
            string id = null;
            try
            {
                Dictionary<string, object> message = Json.ParseObject(raw);
                if (message == null)
                {
                    return;
                }
                id = Json.GetString(message, "id");
                string method = Json.GetString(message, "method");
                Dictionary<string, object> parameters = Json.AsObject(Get(message, "params"));
                object result = await DispatchAsync(method, parameters);
                Send(new Dictionary<string, object>
                {
                    { "id", id },
                    { "ok", true },
                    { "result", result }
                });
            }
            catch (Exception ex)
            {
                // Request messages can contain cookies and signed headers. Never log them.
                string failure = ex.Message;
                for (Exception cause = ex.InnerException; cause != null; cause = cause.InnerException)
                {
                    failure += " / " + cause.Message;
                }
                AppLog.Info("bridge failure: " + ex.GetType().Name + ": " + failure);
                Send(new Dictionary<string, object>
                {
                    { "id", id },
                    { "ok", false },
                    { "error", failure }
                });
            }
        }

        private void Send(Dictionary<string, object> payload)
        {
            try
            {
                core.PostWebMessageAsJson(Json.Stringify(payload));
            }
            catch (Exception ex)
            {
                AppLog.Error("post web message", ex);
            }
        }

        private async Task<object> DispatchAsync(string method, Dictionary<string, object> parameters)
        {
            if (method == null)
            {
                throw new InvalidOperationException("missing method");
            }
            switch (method)
            {
                case "host.info":
                    return HostInfo();
                case "http.request":
                    return await HttpRequestAsync(parameters);
                case "session.cookies":
                    return await CookiesAsync(parameters);
                case "session.clear":
                    core.CookieManager.DeleteAllCookies();
                    return Ok();
                case "shell.openExternal":
                    return OpenExternal(Json.GetString(parameters, "url"));
                case "shell.openPage":
                    return OpenPage(Json.GetString(parameters, "url"));
                case "shell.login":
                    return await LoginAsync();
                case "shell.setTitle":
                    shell.SetWebTitle(Json.GetString(parameters, "title"));
                    return Ok();
                case "shell.metric":
                    return RecordMetric(parameters);
                case "shell.openDataFolder":
                    Process.Start(new ProcessStartInfo("explorer.exe", "\"" + AppPaths.DataDir + "\"") { UseShellExecute = true });
                    return Ok();
                case "shell.copyText":
                    Clipboard.SetText(Json.GetString(parameters, "text") ?? string.Empty);
                    return Ok();
                case "shell.quit":
                    shell.BeginInvoke(new Action(shell.Close));
                    return Ok();
                default:
                    throw new InvalidOperationException("unknown method: " + method);
            }
        }

        private static object Ok()
        {
            return new Dictionary<string, object> { { "ok", true } };
        }

        private object HostInfo()
        {
            string runtime;
            try
            {
                runtime = CoreWebView2Environment.GetAvailableBrowserVersionString();
            }
            catch (Exception ex)
            {
                runtime = "unavailable: " + ex.Message;
            }
            Dictionary<string, object> info = new Dictionary<string, object>
            {
                { "app", AppPaths.AppName },
                { "version", AppPaths.Version },
                { "host", "webview2-winforms" },
                { "runtime", runtime },
                { "dataDir", AppPaths.DataDir },
                { "startupMs", Program.Startup.ElapsedMilliseconds },
                { "os", Environment.OSVersion.VersionString },
                { "arch", Environment.Is64BitProcess ? "x64" : "x86" },
                { "dotnet", Environment.Version.ToString() }
            };
            return info;
        }

        private async Task<object> HttpRequestAsync(Dictionary<string, object> parameters)
        {
            string url = Json.GetString(parameters, "url");
            Uri uri;
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out uri) ||
                (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            {
                throw new InvalidOperationException("invalid url");
            }

            string method = Json.GetString(parameters, "method");
            if (string.IsNullOrEmpty(method))
            {
                method = "GET";
            }

            using (HttpRequestMessage request = new HttpRequestMessage(new HttpMethod(method.ToUpperInvariant()), uri))
            {
                Dictionary<string, object> headers = Json.AsObject(Get(parameters, "headers"));
                if (headers != null)
                {
                    foreach (KeyValuePair<string, object> header in headers)
                    {
                        if (header.Value == null || string.IsNullOrEmpty(header.Key))
                        {
                            continue;
                        }
                        if (string.Equals(header.Key, "Host", StringComparison.OrdinalIgnoreCase) ||
                            string.Equals(header.Key, "Content-Length", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }
                        request.Headers.TryAddWithoutValidation(header.Key, Convert.ToString(header.Value));
                    }
                }

                string body = Json.GetString(parameters, "body");
                if (!string.IsNullOrEmpty(body))
                {
                    string contentType = Json.GetString(parameters, "contentType");
                    request.Content = new StringContent(body, Encoding.UTF8,
                        string.IsNullOrEmpty(contentType) ? "application/json" : contentType);
                }

                using (HttpResponseMessage response = await Http.SendAsync(request))
                {
                    byte[] bytes = await response.Content.ReadAsByteArrayAsync();
                    Dictionary<string, object> responseHeaders = new Dictionary<string, object>();
                    foreach (KeyValuePair<string, IEnumerable<string>> header in response.Headers)
                    {
                        responseHeaders[header.Key] = string.Join(", ", header.Value);
                    }
                    foreach (KeyValuePair<string, IEnumerable<string>> header in response.Content.Headers)
                    {
                        responseHeaders[header.Key] = string.Join(", ", header.Value);
                    }
                    return new Dictionary<string, object>
                    {
                        { "status", (int)response.StatusCode },
                        { "headers", responseHeaders },
                        { "text", Encoding.UTF8.GetString(bytes) },
                        { "bytes", bytes.Length }
                    };
                }
            }
        }

        private async Task<object> CookiesAsync(Dictionary<string, object> parameters)
        {
            string url = Json.GetString(parameters, "url");
            if (string.IsNullOrEmpty(url))
            {
                url = "https://www.zhihu.com";
            }
            List<CoreWebView2Cookie> cookies = await core.CookieManager.GetCookiesAsync(url);
            StringBuilder builder = new StringBuilder();
            foreach (CoreWebView2Cookie cookie in cookies)
            {
                if (builder.Length > 0)
                {
                    builder.Append("; ");
                }
                builder.Append(cookie.Name).Append('=').Append(cookie.Value);
            }
            return new Dictionary<string, object>
            {
                { "url", url },
                { "cookie", builder.ToString() },
                { "count", cookies.Count }
            };
        }

        private static object OpenExternal(string url)
        {
            Uri uri;
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out uri))
            {
                throw new InvalidOperationException("invalid url");
            }
            if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            {
                throw new InvalidOperationException("blocked scheme: " + uri.Scheme);
            }
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            return Ok();
        }

        private object OpenPage(string url)
        {
            Uri uri;
            if (string.IsNullOrEmpty(url) || !Uri.TryCreate(url, UriKind.Absolute, out uri))
            {
                throw new InvalidOperationException("invalid url");
            }
            ReaderWindow window = new ReaderWindow(uri.AbsoluteUri);
            window.Show(shell);
            return Ok();
        }

        private LoginWindow loginWindow;

        private async Task<object> LoginAsync()
        {
            // Let the WebView2 message callback unwind before creating a second
            // controller. A modal loop in that callback blocks WebView2 events.
            await Task.Yield();
            if (loginWindow != null)
            {
                loginWindow.Activate();
                throw new InvalidOperationException("知乎登录窗口已打开。");
            }

            var completion = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
            var window = new LoginWindow();
            loginWindow = window;
            window.FormClosed += delegate
            {
                loginWindow = null;
                completion.TrySetResult(new Dictionary<string, object>
                {
                    { "signedIn", window.SignedIn }
                });
            };
            try
            {
                window.Show(shell);
                return await completion.Task;
            }
            finally
            {
                if (loginWindow == window) loginWindow = null;
                window.Dispose();
            }
        }

        private object RecordMetric(Dictionary<string, object> parameters)
        {
            Dictionary<string, object> entry = new Dictionary<string, object>
            {
                { "t", DateTime.Now.ToString("o") },
                { "name", Json.GetString(parameters, "name") },
                { "value", Get(parameters, "value") },
                { "startupMs", Program.Startup.ElapsedMilliseconds }
            };
            File.AppendAllText(AppPaths.MetricsFile, Json.Stringify(entry) + Environment.NewLine, Encoding.UTF8);
            return Ok();
        }

        private static object Get(Dictionary<string, object> source, string key)
        {
            object value;
            if (source != null && source.TryGetValue(key, out value))
            {
                return value;
            }
            return null;
        }
    }
}

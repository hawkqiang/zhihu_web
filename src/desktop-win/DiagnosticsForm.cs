using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ZhihuWeb
{
    /// <summary>
    /// `zhihu_web.exe --diagnose`
    ///
    /// Opens www.zhihu.com in a real WebView2, waits for the site to write its
    /// own cookies, then calls the endpoints the reader depends on twice: once
    /// plain and once with the x-zse-96 signature produced by web/js/zse96.js.
    /// The result lands in %LOCALAPPDATA%\zhihu_web\data\diagnose.json.
    ///
    /// This is the reproducible check behind the API decisions in docs/, not a
    /// user-facing feature.
    /// </summary>
    internal sealed class DiagnosticsForm : Form
    {
        private static readonly string[] Paths =
        {
            "/api/v3/feed/topstory/hot-lists/total?limit=50&desktop=true",
            "/api/v3/feed/topstory/recommend?desktop=true&page_number=2&limit=8&action=down",
            "/api/v4/search_v3?t=general&q=%E7%BC%96%E7%A8%8B&correction=1&offset=0&limit=20&search_source=Normal",
            "/api/v4/questions/19550517/answers?limit=5&offset=0&platform=desktop&sort_by=default",
            "/api/v4/me?include=name"
        };

        private readonly WebView2 view;
        private bool started;

        internal DiagnosticsForm()
        {
            Text = "zhihu_web diagnostics";
            Size = new Size(920, 720);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(20, 20, 24);
            view = new WebView2();
            view.Dock = DockStyle.Fill;
            Controls.Add(view);
            Load += OnLoadAsync;
        }

        private async void OnLoadAsync(object sender, EventArgs e)
        {
            try
            {
                CoreWebView2Environment environment = await WebEnv.GetAsync();
                await view.EnsureCoreWebView2Async(environment);
                view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                view.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                view.CoreWebView2.Navigate("https://www.zhihu.com/");
            }
            catch (Exception ex)
            {
                AppLog.Error("diagnostics init", ex);
                WriteReport(new Dictionary<string, object> { { "error", ex.Message } });
                Close();
            }
        }

        private async void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (started)
            {
                return;
            }
            started = true;
            Dictionary<string, object> report = new Dictionary<string, object>();
            try
            {
                report["generated"] = DateTime.Now.ToString("o");
                report["appVersion"] = AppPaths.Version;
                report["navigationOk"] = e.IsSuccess;
                report["navigationStatus"] = e.WebErrorStatus.ToString();
                report["runtime"] = CoreWebView2Environment.GetAvailableBrowserVersionString();

                // Give the page a moment to run its own scripts (d_c0, __zse_ck).
                await Task.Delay(3000);
                report["url"] = view.CoreWebView2.Source;

                List<CoreWebView2Cookie> cookies = await view.CoreWebView2.CookieManager.GetCookiesAsync("https://www.zhihu.com");
                List<object> names = new List<object>();
                string dc0 = string.Empty;
                bool hasSession = false;
                bool hasZse = false;
                foreach (CoreWebView2Cookie cookie in cookies)
                {
                    names.Add(cookie.Name);
                    if (cookie.Name == "d_c0")
                    {
                        dc0 = cookie.Value;
                    }
                    if (cookie.Name == "z_c0")
                    {
                        hasSession = true;
                    }
                    if (cookie.Name == "__zse_ck")
                    {
                        hasZse = true;
                    }
                }
                report["cookies"] = new Dictionary<string, object>
                {
                    { "count", cookies.Count },
                    { "names", names },
                    { "hasDc0", !string.IsNullOrEmpty(dc0) },
                    { "hasSession", hasSession },
                    { "hasAntiCrawl", hasZse }
                };

                // Inject the same signer the UI uses and let it be the only
                // source of x-zse-96 in this run.
                string webRoot = Path.Combine(AppPaths.WebRoot, "js");
                string signer = File.ReadAllText(Path.Combine(webRoot, "md5.js"), Encoding.UTF8) + "\n" +
                                File.ReadAllText(Path.Combine(webRoot, "zse96.js"), Encoding.UTF8);
                string injection = await view.CoreWebView2.ExecuteScriptAsync(signer);
                report["signerInjected"] = injection != null && injection.IndexOf("error", StringComparison.OrdinalIgnoreCase) < 0;

                await view.CoreWebView2.ExecuteScriptAsync(BuildProbeScript(dc0));

                Dictionary<string, object> probe = null;
                for (int attempt = 0; attempt < 60; attempt += 1)
                {
                    string raw = await view.CoreWebView2.ExecuteScriptAsync(
                        "window.__diag && window.__diag.done ? JSON.stringify(window.__diag) : null");
                    string decoded = Json.ParseString(raw);
                    if (!string.IsNullOrEmpty(decoded) && decoded != "null")
                    {
                        probe = Json.ParseObject(decoded);
                        break;
                    }
                    await Task.Delay(500);
                }
                report["probe"] = probe ?? (object)"timeout";
                report["probeScript"] = BuildProbeScript(dc0);
            }
            catch (Exception ex)
            {
                AppLog.Error("diagnostics", ex);
                report["error"] = ex.Message;
            }
            WriteReport(report);
            Close();
        }

        private static string BuildProbeScript(string dc0)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("(function(){");
            builder.Append("var paths=").Append(Json.Stringify(Paths)).Append(';');
            builder.Append("var dc0=").Append(Json.Stringify(dc0 ?? string.Empty)).Append(';');
            builder.Append("window.__diag={done:false,unsigned:{},signed:{},startedAt:Date.now()};");
            builder.Append("var origin='https://www.zhihu.com';");
            builder.Append("(async function(){");
            builder.Append("for(var i=0;i<paths.length;i++){var p=paths[i];");
            builder.Append("try{var r=await fetch(origin+p,{headers:{'x-requested-with':'fetch'},credentials:'include',cache:'no-store'});");
            builder.Append("var t=await r.text();window.__diag.unsigned[p]={status:r.status,len:t.length,head:t.slice(0,240)};}catch(e){window.__diag.unsigned[p]={error:String(e)};}}");
            builder.Append("for(var j=0;j<paths.length;j++){var q=paths[j];");
            builder.Append("try{var sig=window.ZW&&window.ZW.sign96?window.ZW.sign96(q,dc0):'';");
            builder.Append("var h={'x-requested-with':'fetch','x-zse-93':'101_3_3.0','x-zse-96':sig,'x-udid':(dc0||'').split('|')[0]};");
            builder.Append("var rr=await fetch(origin+q,{headers:h,credentials:'include',cache:'no-store'});");
            builder.Append("var tt=await rr.text();window.__diag.signed[q]={status:rr.status,len:tt.length,head:tt.slice(0,240),sigPrefix:String(sig).slice(0,12)};}catch(e2){window.__diag.signed[q]={error:String(e2)};}}");
            builder.Append("window.__diag.done=true;window.__diag.elapsedMs=Date.now()-window.__diag.startedAt;");
            builder.Append("})();})();");
            return builder.ToString();
        }

        private static void WriteReport(Dictionary<string, object> report)
        {
            try
            {
                File.WriteAllText(AppPaths.ReportFile, Json.Stringify(report), Encoding.UTF8);
                AppLog.Info("diagnose written: " + AppPaths.ReportFile);
            }
            catch (Exception ex)
            {
                AppLog.Error("write report", ex);
            }
        }
    }
}

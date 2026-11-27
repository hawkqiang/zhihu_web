using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ZhihuWeb
{
    internal sealed class ShellForm : Form
    {
        private readonly WebView2 view;
        private Bridge bridge;
        private bool initialized;

        internal ShellForm()
        {
            Text = AppPaths.AppName;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(760, 560);
            BackColor = Color.FromArgb(20, 20, 24);
            Font = new Font("Microsoft YaHei UI", 9f);
            Icon = AppIcon.Load();

            view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = Color.FromArgb(20, 20, 24);
            Controls.Add(view);

            Load += OnLoadAsync;
            FormClosing += OnFormClosing;
            Resize += OnResize;
        }

        private async void OnLoadAsync(object sender, EventArgs e)
        {
            try
            {
                RestoreWindowState();

                CoreWebView2Environment environment = await WebEnv.GetAsync();
                await view.EnsureCoreWebView2Async(environment);

                CoreWebView2 core = view.CoreWebView2;
                core.Settings.AreDevToolsEnabled = Program.DevMode;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsPinchZoomEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = true;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;

                core.SetVirtualHostNameToFolderMapping(
                    AppPaths.VirtualHost,
                    AppPaths.WebRoot,
                    CoreWebView2HostResourceAccessKind.Allow);

                bridge = new Bridge(core, this);
                core.WebMessageReceived += bridge.OnWebMessageReceived;
                core.NewWindowRequested += OnNewWindowRequested;
                core.NavigationCompleted += OnNavigationCompleted;
                core.ProcessFailed += OnProcessFailed;
                core.DocumentTitleChanged += OnDocumentTitleChanged;

                initialized = true;
                core.Navigate("https://" + AppPaths.VirtualHost + "/index.html");
                AppLog.Info("webview2 runtime=" + CoreWebView2Environment.GetAvailableBrowserVersionString());
            }
            catch (Exception ex)
            {
                AppLog.Error("webview2 init", ex);
                MessageBox.Show(this,
                    "无法初始化 Microsoft Edge WebView2 运行时。\r\n请安装 Evergreen WebView2 Runtime 后重试。\r\n\r\n" + ex.Message,
                    AppPaths.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            AppLog.Info("navigation completed ok=" + e.IsSuccess + " status=" + e.WebErrorStatus + " http=" + e.HttpStatusCode);
            if (!e.IsSuccess && initialized)
            {
                AppLog.Error("navigation failed " + e.WebErrorStatus, null);
            }
        }

        private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            AppLog.Info("webview2 process failed: kind=" + e.ProcessFailedKind + " reason=" + e.Reason);
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                MessageBox.Show(this, "WebView2 浏览器进程已退出，请重新打开 zhihu_web。", AppPaths.AppName);
                Close();
            }
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            // target=_blank / window.open never spawns a second browser engine window:
            // known Zhihu pages open in a child WebView2, everything else in the
            // user's default browser.
            e.Handled = true;
            Uri uri;
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) && IsZhihu(uri))
            {
                new ReaderWindow(uri.AbsoluteUri).Show(this);
            }
            else if (uri != null && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            }
        }

        private static bool IsZhihu(Uri uri)
        {
            string host = uri.Host;
            return host == "zhihu.com" || host.EndsWith(".zhihu.com", StringComparison.OrdinalIgnoreCase);
        }

        private void OnDocumentTitleChanged(object sender, object e)
        {
            // The web UI owns the title; keep the shell passive here.
        }

        internal void SetWebTitle(string title)
        {
            if (!string.IsNullOrEmpty(title))
            {
                Text = title + " · " + AppPaths.AppName;
            }
        }

        private void OnResize(object sender, EventArgs e)
        {
            if (WindowState == FormWindowState.Minimized)
            {
                return;
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            try
            {
                SaveWindowState();
                if (view.CoreWebView2 != null)
                {
                    view.CoreWebView2.WebMessageReceived -= bridge.OnWebMessageReceived;
                }
            }
            catch
            {
                // Best effort.
            }
        }

        private void RestoreWindowState()
        {
            try
            {
                if (!File.Exists(AppPaths.SettingsFile))
                {
                    Size = new Size(1180, 840);
                    return;
                }
                Dictionary<string, object> settings = Json.ParseObject(File.ReadAllText(AppPaths.SettingsFile));
                int width = Json.GetInt(settings, "width", 1180);
                int height = Json.GetInt(settings, "height", 840);
                int left = Json.GetInt(settings, "left", int.MinValue);
                int top = Json.GetInt(settings, "top", int.MinValue);
                int maximized = Json.GetInt(settings, "maximized", 0);
                Size = new Size(Math.Max(width, MinimumSize.Width), Math.Max(height, MinimumSize.Height));
                if (left != int.MinValue && top != int.MinValue && IsOnScreen(left, top, width, height))
                {
                    StartPosition = FormStartPosition.Manual;
                    Location = new Point(left, top);
                }
                if (maximized == 1)
                {
                    WindowState = FormWindowState.Maximized;
                }
            }
            catch (Exception ex)
            {
                AppLog.Error("restore window", ex);
            }
        }

        private static bool IsOnScreen(int left, int top, int width, int height)
        {
            Rectangle bounds = new Rectangle(left, top, width, height);
            foreach (Screen screen in Screen.AllScreens)
            {
                if (screen.WorkingArea.IntersectsWith(bounds))
                {
                    return true;
                }
            }
            return false;
        }

        private void SaveWindowState()
        {
            try
            {
                bool minimized = WindowState == FormWindowState.Minimized;
                bool maximized = WindowState == FormWindowState.Maximized;
                Rectangle bounds = minimized || maximized ? RestoreBounds : Bounds;
                Dictionary<string, object> settings = new Dictionary<string, object>
                {
                    { "width", bounds.Width },
                    { "height", bounds.Height },
                    { "left", bounds.Left },
                    { "top", bounds.Top },
                    { "maximized", maximized ? 1 : 0 }
                };
                File.WriteAllText(AppPaths.SettingsFile, Json.Stringify(settings));
            }
            catch (Exception ex)
            {
                AppLog.Error("save window", ex);
            }
        }
    }

    /// <summary>Loads res/app.ico next to the exe, falling back to the default icon.</summary>
    internal static class AppIcon
    {
        internal static Icon Load()
        {
            try
            {
                string path = Path.Combine(AppPaths.BaseDir, "app.ico");
                if (File.Exists(path))
                {
                    return new Icon(path);
                }
            }
            catch
            {
                // Fall through to the stock icon.
            }
            return SystemIcons.Application;
        }
    }
}

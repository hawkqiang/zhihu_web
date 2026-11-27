using System;
using System.Collections.Generic;
using System.Drawing;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ZhihuWeb
{
    /// <summary>
    /// Login reuses Zhihu's own sign-in page inside a child WebView2, exactly
    /// like the mobile clients of the upstream project: the session cookie
    /// lands in the shared cookie jar and the reader picks it up from there.
    /// No password ever touches app code.
    /// </summary>
    internal sealed class LoginWindow : Form
    {
        private readonly WebView2 view;
        private readonly Label hint;
        private readonly Timer poll;
        private readonly Timer navigationTimeout;
        private readonly Button retry;
        private const string SignInUrl = "https://www.zhihu.com/signin?next=%2F";
        private bool completed;

        internal bool SignedIn { get; private set; }
        internal string SessionCookie { get; private set; }

        internal LoginWindow()
        {
            Text = "登录知乎";
            Size = new Size(740, 720);
            StartPosition = FormStartPosition.CenterParent;
            ShowIcon = false;
            BackColor = Color.White;
            Font = new Font("Microsoft YaHei UI", 9f);

            hint = new Label();
            hint.Dock = DockStyle.Bottom;
            hint.Height = 44;
            hint.TextAlign = ContentAlignment.MiddleCenter;
            hint.ForeColor = Color.FromArgb(160, 200, 255);
            hint.BackColor = Color.FromArgb(28, 30, 36);
            hint.Text = "正在启动知乎登录窗口…";

            retry = new Button();
            retry.Text = "重新加载";
            retry.Dock = DockStyle.Right;
            retry.Width = 100;
            retry.Enabled = false;
            retry.Click += delegate { NavigateToLogin(); };

            Panel footer = new Panel { Dock = DockStyle.Bottom, Height = 44 };
            hint.Dock = DockStyle.Fill;
            footer.Controls.Add(hint);
            footer.Controls.Add(retry);

            view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = Color.White;

            Controls.Add(view);
            Controls.Add(footer);
            Shown += OnLoadAsync;
            navigationTimeout = new Timer { Interval = 15000 };
            navigationTimeout.Tick += delegate
            {
                navigationTimeout.Stop();
                hint.Text = "登录页面加载较慢，请检查网络，或点击重新加载。";
            };
            FormClosed += delegate
            {
                poll.Dispose();
                navigationTimeout.Dispose();
            };

            poll = new Timer();
            poll.Interval = 700;
            poll.Tick += OnPoll;
        }

        private async void OnLoadAsync(object sender, EventArgs e)
        {
            try
            {
                CoreWebView2Environment environment = await WebEnv.GetAsync();
                if (IsDisposed) return;
                await view.EnsureCoreWebView2Async(environment);
                if (IsDisposed) return;
                view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                view.CoreWebView2.Settings.IsWebMessageEnabled = false;
                view.CoreWebView2.NavigationCompleted += OnNavigationCompleted;
                view.CoreWebView2.Settings.AreDevToolsEnabled = false;
                view.CoreWebView2.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs args)
                {
                    args.Handled = true;
                    view.CoreWebView2.Navigate(args.Uri);
                };
                retry.Enabled = true;
                NavigateToLogin();
                poll.Start();
            }
            catch (Exception ex)
            {
                AppLog.Error("login window", ex);
                if (!IsDisposed)
                    hint.Text = "登录窗口初始化失败，请关闭后重试。";
            }
        }

        private void NavigateToLogin()
        {
            hint.Text = "正在加载知乎官方登录页…";
            navigationTimeout.Stop();
            navigationTimeout.Start();
            view.CoreWebView2.Navigate(SignInUrl);
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
            navigationTimeout.Stop();
            if (e.IsSuccess && e.HttpStatusCode < 400)
            {
                hint.Text = "请在上方完成登录，成功后本窗口会自动关闭。";
                return;
            }
            string reason = e.HttpStatusCode >= 400 ? "HTTP " + e.HttpStatusCode : e.WebErrorStatus.ToString();
            AppLog.Info("login navigation failed: " + reason);
            hint.Text = "登录页加载失败（" + reason + "），请检查网络后重试。";
        }

        private async void OnPoll(object sender, EventArgs e)
        {
            if (completed || view.CoreWebView2 == null)
            {
                return;
            }
            poll.Stop();
            try
            {
                List<CoreWebView2Cookie> cookies = await view.CoreWebView2.CookieManager.GetCookiesAsync("https://www.zhihu.com");
                bool hasSession = false;
                StringBuilder builder = new StringBuilder();
                foreach (CoreWebView2Cookie cookie in cookies)
                {
                    if (cookie.Name == "z_c0" && !string.IsNullOrEmpty(cookie.Value))
                    {
                        hasSession = true;
                    }
                    if (builder.Length > 0)
                    {
                        builder.Append("; ");
                    }
                    builder.Append(cookie.Name).Append('=').Append(cookie.Value);
                }
                if (hasSession && !IsDisposed)
                {
                    completed = true;
                    poll.Stop();
                    SignedIn = true;
                    SessionCookie = builder.ToString();
                    DialogResult = DialogResult.OK;
                    Close();
                }
            }
            catch (Exception ex)
            {
                AppLog.Error("login poll", ex);
            }
            finally
            {
                if (!completed && !IsDisposed) poll.Start();
            }
        }
    }
}

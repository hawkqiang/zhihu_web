using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ZhihuWeb
{
    /// <summary>
    /// Read-only secondary window. Used for the full Zhihu page when the light
    /// reader cannot render something, and for links that the web UI hands over.
    /// </summary>
    internal sealed class ReaderWindow : Form
    {
        private readonly string startUrl;
        private readonly WebView2 view;
        private readonly Label status;

        internal ReaderWindow(string url)
        {
            startUrl = url;
            Text = "知乎（内置浏览器）";
            Size = new Size(1000, 760);
            StartPosition = FormStartPosition.CenterParent;
            BackColor = Color.FromArgb(20, 20, 24);
            Font = new Font("Microsoft YaHei UI", 9f);
            ShowIcon = false;

            Panel bar = new Panel();
            bar.Dock = DockStyle.Top;
            bar.Height = 34;
            bar.BackColor = Color.FromArgb(32, 33, 38);

            status = new Label();
            status.AutoEllipsis = true;
            status.Dock = DockStyle.Fill;
            status.ForeColor = Color.FromArgb(200, 200, 205);
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.Padding = new Padding(10, 0, 10, 0);
            status.Text = url;

            Button openBrowser = new Button();
            openBrowser.Text = "用默认浏览器打开";
            openBrowser.Dock = DockStyle.Right;
            openBrowser.Width = 140;
            openBrowser.FlatStyle = FlatStyle.Flat;
            openBrowser.ForeColor = Color.FromArgb(210, 210, 215);
            openBrowser.Click += delegate
            {
                try
                {
                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(startUrl) { UseShellExecute = true });
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, AppPaths.AppName);
                }
            };

            bar.Controls.Add(status);
            bar.Controls.Add(openBrowser);

            view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = Color.White;

            Controls.Add(view);
            Controls.Add(bar);
            Shown += OnLoadAsync;
        }

        private async void OnLoadAsync(object sender, EventArgs e)
        {
            try
            {
                CoreWebView2Environment environment = await WebEnv.GetAsync();
                await view.EnsureCoreWebView2Async(environment);
                view.CoreWebView2.Settings.AreDevToolsEnabled = Program.DevMode;
                view.CoreWebView2.Settings.IsStatusBarEnabled = false;
                view.CoreWebView2.Settings.IsZoomControlEnabled = true;
                view.CoreWebView2.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs args)
                {
                    args.Handled = true;
                    view.CoreWebView2.Navigate(args.Uri);
                };
                view.CoreWebView2.DocumentTitleChanged += delegate
                {
                    Text = view.CoreWebView2.DocumentTitle + " · zhihu_web";
                };
                view.CoreWebView2.SourceChanged += delegate
                {
                    status.Text = view.CoreWebView2.Source;
                };
                view.CoreWebView2.NavigationCompleted += delegate(object s, CoreWebView2NavigationCompletedEventArgs args)
                {
                    if (args.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled) return;
                    if (!args.IsSuccess || args.HttpStatusCode >= 400)
                    {
                        string reason = args.HttpStatusCode >= 400 ? "HTTP " + args.HttpStatusCode : args.WebErrorStatus.ToString();
                        status.Text = "知乎网页加载失败（" + reason + "），可用默认浏览器重试。";
                    }
                };
                view.CoreWebView2.Navigate(startUrl);
            }
            catch (Exception ex)
            {
                AppLog.Error("reader window", ex);
                MessageBox.Show(this, "内置浏览器初始化失败：" + ex.Message, AppPaths.AppName);
            }
        }
    }
}

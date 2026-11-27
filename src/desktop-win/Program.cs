using System;
using System.Diagnostics;
using System.Windows.Forms;

namespace ZhihuWeb
{
    /// <summary>
    /// zhihu_web entry point. The process is a thin WebView2 host:
    /// all product behaviour lives in the static web assets under ./web.
    /// </summary>
    internal static class Program
    {
        internal static readonly Stopwatch Startup = Stopwatch.StartNew();

        internal static bool DiagnoseMode;
        internal static bool DevMode;

        [STAThread]
        private static void Main(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (string.Equals(arg, "--diagnose", StringComparison.OrdinalIgnoreCase))
                {
                    DiagnoseMode = true;
                }
                else if (string.Equals(arg, "--dev", StringComparison.OrdinalIgnoreCase))
                {
                    DevMode = true;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            try
            {
                AppPaths.ApplyEnvironmentOverrides();
                AppPaths.Ensure();
                AppLog.Info("start pid=" + Process.GetCurrentProcess().Id.ToString());
                if (DiagnoseMode)
                {
                    Application.Run(new DiagnosticsForm());
                }
                else
                {
                    Application.Run(new ShellForm());
                }
            }
            catch (Exception ex)
            {
                AppLog.Error("fatal", ex);
                MessageBox.Show(
                    "zhihu_web 启动失败：\r\n" + ex.Message + "\r\n\r\n日志：" + AppPaths.AppLogFile,
                    "zhihu_web",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }
}

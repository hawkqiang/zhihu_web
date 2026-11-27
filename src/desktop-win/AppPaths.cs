using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Web.Script.Serialization;

namespace ZhihuWeb
{
    internal static class AppPaths
    {
        internal const string AppName = "zhihu_web";
        internal const string Version = "0.1.0";
        internal const string VirtualHost = "zhihu-app.zhihu.com";

        internal static string BaseDir
        {
            get { return AppDomain.CurrentDomain.BaseDirectory; }
        }

        internal static string WebRoot
        {
            get { return Path.Combine(BaseDir, "web"); }
        }

        internal static string DataDir
        {
            get
            {
                if (!string.IsNullOrEmpty(dataDirOverride))
                {
                    return dataDirOverride;
                }

                // Portable mode: a marker file next to the exe keeps everything
                // (settings, WebView2 profile, logs) inside the app folder.
                if (File.Exists(Path.Combine(BaseDir, AppName + ".portable")))
                {
                    dataDirOverride = Path.Combine(BaseDir, "data");
                    return dataDirOverride;
                }

                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                dataDirOverride = Path.Combine(Path.Combine(local, AppName), "data");
                return dataDirOverride;
            }
        }

        private static string dataDirOverride;

        /// <summary>ZHIHU_WEB_DATA lets tests and portable deployments relocate state.</summary>
        internal static void ApplyEnvironmentOverrides()
        {
            string custom = Environment.GetEnvironmentVariable("ZHIHU_WEB_DATA");
            if (!string.IsNullOrEmpty(custom))
            {
                dataDirOverride = custom;
            }
        }

        internal static string WebView2DataDir
        {
            get { return Path.Combine(DataDir, "WebView2"); }
        }

        internal static string SettingsFile
        {
            get { return Path.Combine(DataDir, "settings.json"); }
        }

        internal static string MetricsFile
        {
            get { return Path.Combine(DataDir, "metrics.jsonl"); }
        }

        internal static string ReportFile
        {
            get { return Path.Combine(DataDir, "diagnose.json"); }
        }

        internal static string AppLogFile
        {
            get { return Path.Combine(DataDir, "app.log"); }
        }

        internal static void Ensure()
        {
            try
            {
                Directory.CreateDirectory(DataDir);
            }
            catch (Exception ex)
            {
                // A read-only profile (locked-down machine, sandbox) must not be
                // fatal: fall back to a data folder next to the executable.
                AppLog.WriteRaw("WARN", "data dir not writable: " + ex.Message);
                AppPaths.dataDirOverride = Path.Combine(BaseDir, "data");
                Directory.CreateDirectory(AppPaths.dataDirOverride);
            }
        }
    }

    internal static class AppLog
    {
        private static readonly object Sync = new object();

        internal static void Info(string message)
        {
            Write("INFO", message);
        }

        internal static void Error(string message, Exception ex)
        {
            Write("ERROR", message + (ex == null ? string.Empty : " :: " + ex.GetType().Name + ": " + ex.Message + Environment.NewLine + ex.StackTrace));
        }

        private static void Write(string level, string message)
        {
            try
            {
                lock (Sync)
                {
                    string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " [" + level + "] " + message + Environment.NewLine;
                    File.AppendAllText(AppPaths.AppLogFile, line, Encoding.UTF8);
                }
            }
            catch
            {
                // Logging must never break the app.
            }
        }

        internal static void WriteRaw(string level, string message)
        {
            Write(level, message);
        }
    }

    /// <summary>Small JSON facade over JavaScriptSerializer (in-box .NET Framework).</summary>
    internal static class Json
    {
        private static readonly JavaScriptSerializer Serializer = CreateSerializer();

        private static JavaScriptSerializer CreateSerializer()
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = 64 * 1024 * 1024;
            serializer.RecursionLimit = 256;
            return serializer;
        }

        internal static Dictionary<string, object> ParseObject(string json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }
            return Serializer.DeserializeObject(json) as Dictionary<string, object>;
        }

        internal static Dictionary<string, object> AsObject(object value)
        {
            return value as Dictionary<string, object>;
        }

        internal static string GetString(Dictionary<string, object> source, string key)
        {
            object value;
            if (source != null && source.TryGetValue(key, out value) && value != null)
            {
                return Convert.ToString(value);
            }
            return null;
        }

        internal static int GetInt(Dictionary<string, object> source, string key, int fallback)
        {
            object value;
            if (source != null && source.TryGetValue(key, out value) && value != null)
            {
                try
                {
                    return Convert.ToInt32(value);
                }
                catch
                {
                    return fallback;
                }
            }
            return fallback;
        }

        internal static string Stringify(object value)
        {
            return Serializer.Serialize(value);
        }

        /// <summary>Decode the JSON string literal that ExecuteScriptAsync returns.</summary>
        internal static string ParseString(string json)
        {
            if (string.IsNullOrEmpty(json) || json == "null")
            {
                return null;
            }
            try
            {
                return Serializer.Deserialize<string>(json);
            }
            catch
            {
                return json;
            }
        }
    }
}

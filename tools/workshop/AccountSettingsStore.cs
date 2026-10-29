// This file is subject to the terms and conditions defined
// in file 'LICENSE', which is part of this source code package.

// Vertex adaptation of DepotDownloader 3.4.0: session transfer through private pipes.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace DepotDownloader
{
    class AccountSettingsStore
    {
        public ConcurrentDictionary<string, int> ContentServerPenalty { get; } = new();
        public Dictionary<string, string> LoginTokens { get; private set; } = new(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, string> GuardData { get; private set; } = new(StringComparer.OrdinalIgnoreCase);
        private static bool SessionPipe;
        public static AccountSettingsStore Instance;

        public sealed class SessionData
        {
            public int Version { get; set; } = 1;
            public Dictionary<string, string> LoginTokens { get; set; } = new();
            public Dictionary<string, string> GuardData { get; set; } = new();
        }

        public static void LoadFromFile(string filename)
        {
            if (Instance != null) throw new InvalidOperationException("Config already loaded");
            Instance = new AccountSettingsStore();
            SessionPipe = Environment.GetEnvironmentVariable("VERTEX_WORKSHOP_SESSION_PIPE") == "1";
            if (!SessionPipe) return;
            var input = Console.ReadLine();
            if (input == null || input.Length > 32768) throw new InvalidDataException("Invalid session input");
            var data = JsonSerializer.Deserialize<SessionData>(input);
            if (data == null || data.Version != 1) throw new InvalidDataException("Invalid session format");
            Instance.LoginTokens = new(data.LoginTokens, StringComparer.OrdinalIgnoreCase);
            Instance.GuardData = new(data.GuardData, StringComparer.OrdinalIgnoreCase);
        }

        public static void Save()
        {
            if (Instance == null) throw new InvalidOperationException("Config not loaded");
            if (!SessionPipe) return;
            // The parent consumes this protocol line; it must never be copied to user logs.
            Console.WriteLine("VERTEX_SESSION:" + JsonSerializer.Serialize(new SessionData
            {
                LoginTokens = Instance.LoginTokens,
                GuardData = Instance.GuardData
            }));
        }
    }
}

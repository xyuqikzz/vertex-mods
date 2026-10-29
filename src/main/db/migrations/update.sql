CREATE TABLE IF NOT EXISTS mod_runtime_files
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL,
  mod_id        INTEGER NOT NULL,
  endpoint_type INTEGER NOT NULL DEFAULT 0,
  file_path     TEXT    NOT NULL,
  backup_path   TEXT    NOT NULL DEFAULT '',
  file_hash     TEXT    NOT NULL DEFAULT '',
  state         TEXT    NOT NULL DEFAULT 'active',
  metadata_json TEXT    NOT NULL DEFAULT '{}',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mod_id, file_path, endpoint_type)
);

CREATE INDEX IF NOT EXISTS idx_mod_runtime_files_mod_id
ON mod_runtime_files (mod_id, endpoint_type);

CREATE INDEX IF NOT EXISTS idx_download_records_source_platform
ON download_records (source_platform);

CREATE TABLE IF NOT EXISTS thunderstore_profiles
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        INTEGER NOT NULL DEFAULT 0,
  community      TEXT NOT NULL,
  profile_name   TEXT NOT NULL,
  package_loader TEXT DEFAULT '',
  app_id         TEXT NOT NULL DEFAULT '',
  game_exe_path  TEXT DEFAULT '',
  profile_root   TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (community, profile_name)
);

CREATE INDEX IF NOT EXISTS idx_thunderstore_profiles_game_id
ON thunderstore_profiles (game_id);

CREATE TABLE IF NOT EXISTS nexus_game_rule
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nexus_game_id INTEGER NOT NULL,
  game_id       INTEGER DEFAULT 0,
  domain_name   TEXT    DEFAULT '',
  rule_version  INTEGER NOT NULL,
  rule_json     TEXT    NOT NULL DEFAULT '{}',
  source_type   TEXT    NOT NULL DEFAULT 'server',
  rule_checksum TEXT    DEFAULT '',
  trust_level   TEXT    DEFAULT 'community',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (nexus_game_id, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_nexus_game_rule_latest
ON nexus_game_rule (nexus_game_id, rule_version);

CREATE TABLE IF NOT EXISTS nexus_game_rule_override
(
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nexus_game_id         INTEGER DEFAULT 0,
  game_id               INTEGER DEFAULT 0,
  app_id                INTEGER DEFAULT 0,
  domain_name           TEXT    NOT NULL DEFAULT '',
  rule_version          INTEGER DEFAULT 0,
  rule_json             TEXT    NOT NULL DEFAULT '{}',
  base_rule_version     INTEGER DEFAULT 0,
  base_rule_json        TEXT    NOT NULL DEFAULT '',
  dismissed_rule_version INTEGER DEFAULT 0,
  dismissed_rule_json   TEXT    NOT NULL DEFAULT '',
  source_type           TEXT    NOT NULL DEFAULT 'local_override',
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (domain_name)
);

CREATE INDEX IF NOT EXISTS idx_nexus_game_rule_override_lookup
ON nexus_game_rule_override (domain_name, nexus_game_id);

CREATE TABLE IF NOT EXISTS modio_game_rule
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  modio_game_id INTEGER NOT NULL,
  game_id       INTEGER DEFAULT 0,
  name_id       TEXT    DEFAULT '',
  rule_version  INTEGER NOT NULL,
  rule_json     TEXT    NOT NULL DEFAULT '{}',
  source_type   TEXT    NOT NULL DEFAULT 'server',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (modio_game_id, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_modio_game_rule_latest
ON modio_game_rule (modio_game_id, rule_version);

CREATE TABLE IF NOT EXISTS ai_translation_cache
(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key       TEXT    NOT NULL UNIQUE,
  source          TEXT    NOT NULL DEFAULT '',
  scene           TEXT    NOT NULL DEFAULT '',
  item_kind       TEXT    NOT NULL DEFAULT 'text',
  provider_type   TEXT    NOT NULL DEFAULT '',
  base_url        TEXT    NOT NULL DEFAULT '',
  model           TEXT    NOT NULL DEFAULT '',
  target_language TEXT    NOT NULL DEFAULT '',
  prompt_hash     TEXT    NOT NULL DEFAULT '',
  text_hash       TEXT    NOT NULL DEFAULT '',
  source_text     TEXT    NOT NULL DEFAULT '',
  translated_text TEXT    NOT NULL DEFAULT '',
  shared_uploaded_at TIMESTAMP DEFAULT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_lookup
ON ai_translation_cache (source, scene, model, target_language, item_kind);

CREATE TABLE IF NOT EXISTS ai_translation_cache_scope
(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key    TEXT    NOT NULL,
  source       TEXT    NOT NULL DEFAULT '',
  scene        TEXT    NOT NULL DEFAULT '',
  item_kind    TEXT    NOT NULL DEFAULT 'text',
  context_text TEXT    NOT NULL DEFAULT '',
  scope_type   TEXT    NOT NULL DEFAULT '',
  scope_key    TEXT    NOT NULL DEFAULT '',
  scope_label  TEXT    NOT NULL DEFAULT '',
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (cache_key, source, scene, item_kind, scope_type, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_scope_lookup
ON ai_translation_cache_scope (source, scope_key, scene, item_kind);

CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_scope_cache_key
ON ai_translation_cache_scope (cache_key);

CREATE INDEX IF NOT EXISTS idx_mods_priority_scope
ON mods (game_id, endpoint_type, deploy_domain, priority_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS mod_deploy_domains
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id       INTEGER NOT NULL,
  source        TEXT    NOT NULL DEFAULT '',
  endpoint_type INTEGER NOT NULL DEFAULT 0,
  deploy_domain TEXT    NOT NULL DEFAULT '',
  target_root   TEXT    NOT NULL DEFAULT '',
  metadata_json TEXT    NOT NULL DEFAULT '{}',
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_id, source, endpoint_type, deploy_domain)
);

CREATE INDEX IF NOT EXISTS idx_mod_deploy_domains_scope
ON mod_deploy_domains (game_id, source, endpoint_type, deploy_domain);

CREATE TABLE IF NOT EXISTS mod_deploy_transactions
(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT    NOT NULL DEFAULT '',
  agent_task_id   TEXT    NOT NULL DEFAULT '',
  task_type       TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'queued',
  reconcile_type  TEXT    NOT NULL DEFAULT '',
  game_id         INTEGER NOT NULL DEFAULT 0,
  source          TEXT    NOT NULL DEFAULT '',
  endpoint_type   INTEGER NOT NULL DEFAULT 0,
  deploy_domain   TEXT    NOT NULL DEFAULT '',
  mod_id          INTEGER NOT NULL DEFAULT 0,
  payload_json    TEXT    NOT NULL DEFAULT '{}',
  result_json     TEXT    NOT NULL DEFAULT '{}',
  error_code      TEXT    NOT NULL DEFAULT '',
  error_message   TEXT    NOT NULL DEFAULT '',
  started_at      TEXT    NOT NULL DEFAULT '',
  finished_at     TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mod_deploy_transactions_scope
ON mod_deploy_transactions (game_id, source, endpoint_type, deploy_domain, status);

CREATE INDEX IF NOT EXISTS idx_mod_deploy_transactions_agent_task
ON mod_deploy_transactions (agent_task_id, updated_at);

CREATE TABLE IF NOT EXISTS mod_file_manifest
(
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  mod_id               INTEGER NOT NULL,
  game_id              INTEGER NOT NULL DEFAULT 0,
  source               TEXT    NOT NULL DEFAULT '',
  endpoint_type        INTEGER NOT NULL DEFAULT 0,
  deploy_domain        TEXT    NOT NULL DEFAULT '',
  source_path          TEXT    NOT NULL DEFAULT '',
  target_relative_path TEXT    NOT NULL DEFAULT '',
  target_path          TEXT    NOT NULL DEFAULT '',
  file_hash            TEXT    NOT NULL DEFAULT '',
  file_size            INTEGER NOT NULL DEFAULT 0,
  deploy_method        TEXT    NOT NULL DEFAULT 'link',
  source_type          TEXT    NOT NULL DEFAULT '',
  metadata_json        TEXT    NOT NULL DEFAULT '{}',
  created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (mod_id, endpoint_type, deploy_domain, target_relative_path)
);

CREATE INDEX IF NOT EXISTS idx_mod_file_manifest_scope
ON mod_file_manifest (game_id, endpoint_type, deploy_domain, target_relative_path);

CREATE TABLE IF NOT EXISTS mod_file_owners
(
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id              INTEGER NOT NULL DEFAULT 0,
  endpoint_type        INTEGER NOT NULL DEFAULT 0,
  deploy_domain        TEXT    NOT NULL DEFAULT '',
  target_relative_path TEXT    NOT NULL DEFAULT '',
  target_path          TEXT    NOT NULL DEFAULT '',
  target_path_key      TEXT    NOT NULL DEFAULT '',
  owner_mod_id         INTEGER NOT NULL DEFAULT 0,
  owner_priority_order INTEGER NOT NULL DEFAULT 0,
  file_hash            TEXT    NOT NULL DEFAULT '',
  metadata_json        TEXT    NOT NULL DEFAULT '{}',
  created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_id, endpoint_type, deploy_domain, target_path_key)
);

CREATE INDEX IF NOT EXISTS idx_mod_file_owners_owner
ON mod_file_owners (owner_mod_id, game_id, endpoint_type);

CREATE TABLE IF NOT EXISTS mod_backup_snapshots
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id        INTEGER NOT NULL DEFAULT 0,
  endpoint_type  INTEGER NOT NULL DEFAULT 0,
  deploy_domain  TEXT    NOT NULL DEFAULT '',
  mod_id         INTEGER NOT NULL DEFAULT 0,
  target_path     TEXT    NOT NULL DEFAULT '',
  snapshot_path   TEXT    NOT NULL DEFAULT '',
  file_hash       TEXT    NOT NULL DEFAULT '',
  state           TEXT    NOT NULL DEFAULT 'active',
  metadata_json   TEXT    NOT NULL DEFAULT '{}',
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (game_id, endpoint_type, deploy_domain, target_path)
);

CREATE INDEX IF NOT EXISTS idx_mod_backup_snapshots_mod
ON mod_backup_snapshots (mod_id, state);

CREATE TABLE IF NOT EXISTS mod_deploy_backup_entries
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT    NOT NULL DEFAULT '',
  agent_task_id  TEXT    NOT NULL DEFAULT '',
  game_id        INTEGER NOT NULL DEFAULT 0,
  endpoint_type  INTEGER NOT NULL DEFAULT 0,
  deploy_domain  TEXT    NOT NULL DEFAULT '',
  mod_id         INTEGER NOT NULL DEFAULT 0,
  target_path    TEXT    NOT NULL DEFAULT '',
  backup_path    TEXT    NOT NULL DEFAULT '',
  reason         TEXT    NOT NULL DEFAULT '',
  state          TEXT    NOT NULL DEFAULT 'active',
  metadata_json  TEXT    NOT NULL DEFAULT '{}',
  created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mod_deploy_backup_entries_session
ON mod_deploy_backup_entries (session_id, game_id, endpoint_type, deploy_domain);

CREATE INDEX IF NOT EXISTS idx_mod_deploy_backup_entries_agent_task
ON mod_deploy_backup_entries (agent_task_id, updated_at);


CREATE TABLE IF NOT EXISTS source_modpack_instances
(
  instance_id TEXT PRIMARY KEY,
  remote_pack_uid TEXT NOT NULL,
  remote_pack_id INTEGER NOT NULL DEFAULT 0,
  share_code TEXT NOT NULL DEFAULT '',
  local_game_installation_id INTEGER NOT NULL,
  endpoint_type INTEGER NOT NULL DEFAULT 0,
  instance_slot TEXT NOT NULL DEFAULT 'default',
  installed_revision INTEGER NOT NULL DEFAULT 0,
  installed_manifest_hash TEXT NOT NULL DEFAULT '',
  desired_revision INTEGER NOT NULL DEFAULT 0,
  desired_manifest_hash TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'installing',
  last_error_code TEXT NOT NULL DEFAULT '',
  last_error_message TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT NOT NULL DEFAULT '',
  installed_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (remote_pack_uid, local_game_installation_id, endpoint_type, instance_slot)
);

CREATE TABLE IF NOT EXISTS source_modpack_instance_targets
(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  source_platform TEXT NOT NULL,
  source_game_id TEXT NOT NULL DEFAULT '',
  profile_id TEXT NOT NULL,
  profile_name TEXT NOT NULL DEFAULT '',
  game_root TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (instance_id, source_platform, source_game_id, profile_id)
);

CREATE TABLE IF NOT EXISTS source_modpack_instance_items
(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  origin_item_key TEXT NOT NULL DEFAULT '',
  source_platform TEXT NOT NULL,
  source_game_id TEXT NOT NULL DEFAULT '',
  source_mod_id TEXT NOT NULL DEFAULT '',
  source_file_id TEXT NOT NULL DEFAULT '',
  source_mod_key TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  cover TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  local_mod_id INTEGER,
  dependency_role TEXT NOT NULL DEFAULT 'main',
  ownership_mode TEXT NOT NULL DEFAULT 'referenced',
  installed_item_hash TEXT NOT NULL DEFAULT '',
  installed_payload_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL DEFAULT 'installed',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (instance_id, item_key, dependency_role, origin_item_key)
);

CREATE TABLE IF NOT EXISTS source_modpack_instance_plans
(
  plan_token TEXT PRIMARY KEY,
  plan_hash TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  remote_pack_uid TEXT NOT NULL,
  remote_revision INTEGER NOT NULL DEFAULT 0,
  base_state_hash TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'inspected',
  plan_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_modpack_instance_jobs
(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_id TEXT NOT NULL,
  plan_token TEXT NOT NULL,
  job_id TEXT NOT NULL UNIQUE,
  source_platform TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'queued',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_modpack_instances_remote
ON source_modpack_instances (remote_pack_uid, local_game_installation_id, endpoint_type);

CREATE INDEX IF NOT EXISTS idx_source_modpack_instance_items_mod
ON source_modpack_instance_items (local_mod_id, ownership_mode, state);

CREATE INDEX IF NOT EXISTS idx_source_modpack_instance_jobs_instance
ON source_modpack_instance_jobs (instance_id, plan_token, state);

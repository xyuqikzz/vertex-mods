CREATE TABLE IF NOT EXISTS download_records
(
  id           INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  task_id      INTEGER NOT NULL UNIQUE,           -- 下载任务ID（唯一）
  task_name    TEXT    NOT NULL,                  -- 下载任务名称
  module       TEXT    NOT NULL,                  -- 所属模块标识
  source_platform TEXT NOT NULL DEFAULT '',       -- 下载来源平台
  file_type    TEXT    NOT NULL,                  -- 文件类型
  file_size    INTEGER   DEFAULT 0,               -- 文件大小（字节）
  file_path    TEXT,                              -- 本地文件保存路径
  download_url TEXT    NOT NULL,                  -- 下载地址
  is_show_open int       DEFAULT 1,               -- 是否显示“打开文件”按钮（1-是，0-否）
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 记录创建时间
  finished_at  TIMESTAMP                          -- 下载完成时间
);

CREATE TABLE IF NOT EXISTS games
(
  id                      INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  source                  TEXT    NOT NULL,                  -- 来源类型
  source_id               TEXT    NOT NULL,                  -- 来源游戏ID
  source_slug             TEXT    NOT NULL DEFAULT '',       -- 来源辅助标识（如 community/domain）
  game_id                 INTEGER NOT NULL DEFAULT 0,        -- 来源业务ID（兼容旧逻辑）
  app_id                  TEXT    NOT NULL DEFAULT '',       -- 安装识别ID（如 steam app id）
  name                    TEXT    NOT NULL DEFAULT '',       -- 游戏名称
  english_name            TEXT    NOT NULL DEFAULT '',       -- 游戏英文名称
  cover_image             TEXT    NOT NULL DEFAULT '',       -- 封面图
  background_image        TEXT    NOT NULL DEFAULT '',       -- 背景图
  description             TEXT    NOT NULL DEFAULT '',       -- 游戏描述
  client_root_path        TEXT    NOT NULL DEFAULT '',       -- 客户端根目录
  client_exe_path         TEXT    NOT NULL DEFAULT '',       -- 客户端可执行文件路径
  server_exe_path         TEXT    NOT NULL DEFAULT '',       -- 服务端可执行文件路径
  is_server_installed     INTEGER NOT NULL DEFAULT 0,        -- 服务端是否已安装（1-是，0-否）
  server_install_mod_type INTEGER NOT NULL DEFAULT 0,        -- 服务端模组安装类型
  metadata_json           TEXT    NOT NULL DEFAULT '{}',     -- 来源扩展数据
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 记录创建时间
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 记录更新时间
  UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_games_app_id
ON games (app_id);

CREATE INDEX IF NOT EXISTS idx_games_source_slug
ON games (source, source_slug);

CREATE INDEX IF NOT EXISTS idx_games_game_id
ON games (game_id);

CREATE TABLE IF NOT EXISTS mods
(
  id                 INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  game_id            INTEGER NOT NULL,                  -- 关联的游戏记录ID，外键指向 games.id
  source             TEXT    NOT NULL DEFAULT '',       -- 来源类型
  mod_id             TEXT    NOT NULL DEFAULT '',       -- 来源模组ID
  option_id          TEXT    NOT NULL DEFAULT '',       -- 来源选项ID
  source_mod_key     TEXT    NOT NULL DEFAULT '',       -- 来源模组唯一键
  name               TEXT    NOT NULL DEFAULT '',       -- 模组名称
  option_name        TEXT    NOT NULL DEFAULT '',       -- 模组选项名称
  description        TEXT    NOT NULL DEFAULT '',       -- 模组描述
  version            TEXT    NOT NULL DEFAULT '',       -- 模组版本号
  download_url       TEXT    NOT NULL DEFAULT '',       -- 下载地址
  file_size          INTEGER NOT NULL DEFAULT 0,        -- 模组文件大小(字节)
  install_paths_json TEXT    NOT NULL DEFAULT '[]',     -- 安装路径JSON
  dependencies_json  TEXT    NOT NULL DEFAULT '[]',     -- 依赖信息JSON
  files_json         TEXT    NOT NULL DEFAULT '[]',     -- 安装文件列表JSON
  metadata_json      TEXT    NOT NULL DEFAULT '{}',     -- 模组元数据JSON
  install_type       INTEGER NOT NULL DEFAULT 0,        -- 安装类型
  usage_type         INTEGER NOT NULL DEFAULT 0,        -- 使用类型
  cover              TEXT    NOT NULL DEFAULT '',       -- 模组封面
  type_id            INTEGER NOT NULL DEFAULT 0,        -- 模组分类ID
  endpoint_type      INTEGER NOT NULL DEFAULT 0 CHECK (endpoint_type IN (0, 1)), -- 终端类型
  file_md5           TEXT    NOT NULL DEFAULT '',       -- MOD文件MD5
  mod_version        TEXT    NOT NULL DEFAULT '',       -- MOD版本描述（兼容旧字段）
  package_owner      TEXT    NOT NULL DEFAULT '',       -- 包作者
  package_name       TEXT    NOT NULL DEFAULT '',       -- 包名称
  profile_name       TEXT    NOT NULL DEFAULT '',       -- 配置名称
  archive_path       TEXT    NOT NULL DEFAULT '',       -- 压缩包路径
  staging_path       TEXT    NOT NULL DEFAULT '',       -- 暂存路径
  target_path        TEXT    NOT NULL DEFAULT '',       -- 最终部署路径
  install_state      INTEGER NOT NULL DEFAULT 1,        -- 安装状态（1启用 0禁用）
  is_active          INTEGER NOT NULL DEFAULT 1,        -- 模组是否启用
  priority_order     INTEGER NOT NULL DEFAULT 0,        -- 同部署域排序优先级，UI 从小到大展示，值越大越晚覆盖
  deploy_domain      TEXT    NOT NULL DEFAULT '',       -- 部署域
  install_model      TEXT    NOT NULL DEFAULT 'legacy', -- 接管模型：legacy/hybrid/managed
  last_reconcile_at  TEXT    NOT NULL DEFAULT '',       -- 最近一次协调部署时间
  compat_flags       TEXT    NOT NULL DEFAULT '[]',     -- 兼容标记JSON
  source_status      TEXT    NOT NULL DEFAULT 'normal', -- 源文件状态：normal/missing/unchecked
  source_status_checked_at TEXT NOT NULL DEFAULT '',    -- 上次源文件校验时间
  source_lock_state  TEXT    NOT NULL DEFAULT 'unlocked', -- 源文件加锁状态：locked/unlocked/lock_failed/unlock_failed
  source_lock_at     TEXT    NOT NULL DEFAULT '',       -- 上次加锁或解锁时间
  source_root_path   TEXT    NOT NULL DEFAULT '',       -- 托管源文件根目录（优先作为 ACL 锁定目标）
  installed_at       TEXT    NOT NULL DEFAULT '',       -- 安装时间
  updated_at         TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  FOREIGN KEY (game_id) REFERENCES games (id),
  UNIQUE (game_id, source_mod_key, endpoint_type, profile_name)
);

CREATE INDEX IF NOT EXISTS idx_mods_game_id
ON mods (game_id, endpoint_type);

CREATE INDEX IF NOT EXISTS idx_mods_source
ON mods (source, mod_id);


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


CREATE TABLE IF NOT EXISTS mod_runtime_files
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增主键ID
  game_id       INTEGER NOT NULL,                    -- 游戏记录ID
  mod_id        INTEGER NOT NULL,                    -- 模组记录ID
  endpoint_type INTEGER NOT NULL DEFAULT 0,          -- 终端类型
  file_path     TEXT    NOT NULL,                    -- 原始文件路径
  backup_path   TEXT    NOT NULL DEFAULT '',         -- 备份文件路径
  file_hash     TEXT    NOT NULL DEFAULT '',         -- 文件哈希
  state         TEXT    NOT NULL DEFAULT 'active',   -- 文件状态
  metadata_json TEXT    NOT NULL DEFAULT '{}',       -- 额外元数据
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  UNIQUE (mod_id, file_path, endpoint_type)
);

CREATE INDEX IF NOT EXISTS idx_mod_runtime_files_mod_id
ON mod_runtime_files (mod_id, endpoint_type);

CREATE TABLE IF NOT EXISTS mod_deploy_domains
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增主键ID
  game_id       INTEGER NOT NULL,                    -- 游戏记录ID
  source        TEXT    NOT NULL DEFAULT '',         -- 模组来源
  endpoint_type INTEGER NOT NULL DEFAULT 0,          -- 终端类型
  deploy_domain TEXT    NOT NULL DEFAULT '',         -- 部署域
  target_root   TEXT    NOT NULL DEFAULT '',         -- 目标根目录
  metadata_json TEXT    NOT NULL DEFAULT '{}',       -- 元数据JSON
  created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  UNIQUE (game_id, source, endpoint_type, deploy_domain)
);

CREATE TABLE IF NOT EXISTS mod_deploy_transactions
(
  id              INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  task_id         TEXT    NOT NULL DEFAULT '',       -- 任务ID
  task_type       TEXT    NOT NULL DEFAULT '',       -- 任务类型
  status          TEXT    NOT NULL DEFAULT 'queued', -- 任务状态
  reconcile_type  TEXT    NOT NULL DEFAULT '',       -- 协调类型
  game_id         INTEGER NOT NULL DEFAULT 0,        -- 游戏记录ID
  source          TEXT    NOT NULL DEFAULT '',       -- 模组来源
  endpoint_type   INTEGER NOT NULL DEFAULT 0,        -- 终端类型
  deploy_domain   TEXT    NOT NULL DEFAULT '',       -- 部署域
  mod_id          INTEGER NOT NULL DEFAULT 0,        -- 模组记录ID
  payload_json    TEXT    NOT NULL DEFAULT '{}',     -- 入参JSON
  result_json     TEXT    NOT NULL DEFAULT '{}',     -- 结果JSON
  error_code      TEXT    NOT NULL DEFAULT '',       -- 错误码
  error_message   TEXT    NOT NULL DEFAULT '',       -- 错误信息
  started_at      TEXT    NOT NULL DEFAULT '',       -- 开始时间
  finished_at     TEXT    NOT NULL DEFAULT '',       -- 完成时间
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP  -- 更新时间
);

CREATE TABLE IF NOT EXISTS mod_file_manifest
(
  id                   INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  mod_id               INTEGER NOT NULL,                  -- 模组记录ID
  game_id              INTEGER NOT NULL DEFAULT 0,        -- 游戏记录ID
  source               TEXT    NOT NULL DEFAULT '',       -- 模组来源
  endpoint_type        INTEGER NOT NULL DEFAULT 0,        -- 终端类型
  deploy_domain        TEXT    NOT NULL DEFAULT '',       -- 部署域
  source_path          TEXT    NOT NULL DEFAULT '',       -- 来源文件路径
  target_relative_path TEXT    NOT NULL DEFAULT '',       -- 目标相对路径
  target_path          TEXT    NOT NULL DEFAULT '',       -- 目标绝对路径
  file_hash            TEXT    NOT NULL DEFAULT '',       -- 文件哈希
  file_size            INTEGER NOT NULL DEFAULT 0,        -- 文件大小
  deploy_method        TEXT    NOT NULL DEFAULT 'link',   -- 部署方式
  source_type          TEXT    NOT NULL DEFAULT '',       -- 来源类型
  metadata_json        TEXT    NOT NULL DEFAULT '{}',     -- 元数据JSON
  created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  UNIQUE (mod_id, endpoint_type, deploy_domain, target_relative_path)
);

CREATE TABLE IF NOT EXISTS mod_file_owners
(
  id                   INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  game_id              INTEGER NOT NULL DEFAULT 0,        -- 游戏记录ID
  endpoint_type        INTEGER NOT NULL DEFAULT 0,        -- 终端类型
  deploy_domain        TEXT    NOT NULL DEFAULT '',       -- 部署域
  target_relative_path TEXT    NOT NULL DEFAULT '',       -- 目标相对路径
  target_path          TEXT    NOT NULL DEFAULT '',       -- 目标绝对路径
  target_path_key      TEXT    NOT NULL DEFAULT '',       -- 归一化目标身份
  owner_mod_id         INTEGER NOT NULL DEFAULT 0,        -- 当前文件归属模组
  owner_priority_order INTEGER NOT NULL DEFAULT 0,        -- 当前归属优先级
  file_hash            TEXT    NOT NULL DEFAULT '',       -- 文件哈希
  metadata_json        TEXT    NOT NULL DEFAULT '{}',     -- 元数据JSON
  created_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at           TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  UNIQUE (game_id, endpoint_type, deploy_domain, target_path_key)
);

CREATE TABLE IF NOT EXISTS mod_backup_snapshots
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  game_id        INTEGER NOT NULL DEFAULT 0,        -- 游戏记录ID
  endpoint_type  INTEGER NOT NULL DEFAULT 0,        -- 终端类型
  deploy_domain  TEXT    NOT NULL DEFAULT '',       -- 部署域
  mod_id         INTEGER NOT NULL DEFAULT 0,        -- 模组记录ID
  target_path     TEXT    NOT NULL DEFAULT '',       -- 目标路径
  snapshot_path   TEXT    NOT NULL DEFAULT '',       -- 快照路径
  file_hash       TEXT    NOT NULL DEFAULT '',       -- 文件哈希
  state           TEXT    NOT NULL DEFAULT 'active', -- 快照状态
  metadata_json   TEXT    NOT NULL DEFAULT '{}',     -- 元数据JSON
  created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  UNIQUE (game_id, endpoint_type, deploy_domain, target_path)
);

CREATE TABLE IF NOT EXISTS mod_deploy_backup_entries
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  session_id     TEXT    NOT NULL DEFAULT '',       -- 部署会话ID
  game_id        INTEGER NOT NULL DEFAULT 0,        -- 游戏记录ID
  endpoint_type  INTEGER NOT NULL DEFAULT 0,        -- 终端类型
  deploy_domain  TEXT    NOT NULL DEFAULT '',       -- 部署域
  mod_id         INTEGER NOT NULL DEFAULT 0,        -- 关联模组ID
  target_path    TEXT    NOT NULL DEFAULT '',       -- 被备份目标路径
  backup_path    TEXT    NOT NULL DEFAULT '',       -- 备份文件路径
  reason         TEXT    NOT NULL DEFAULT '',       -- 备份原因
  state          TEXT    NOT NULL DEFAULT 'active', -- 备份状态
  metadata_json  TEXT    NOT NULL DEFAULT '{}',     -- 元数据JSON
  created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP  -- 更新时间
);

CREATE INDEX IF NOT EXISTS idx_mod_deploy_backup_entries_session
ON mod_deploy_backup_entries (session_id, game_id, endpoint_type, deploy_domain);

CREATE TABLE IF NOT EXISTS game_name_dict_meta
(
  key        TEXT PRIMARY KEY,                -- 配置键
  value      TEXT NOT NULL DEFAULT '',         -- 配置值
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP -- 更新时间
);

CREATE TABLE IF NOT EXISTS game_name_dict_alias
(
  id                  INTEGER PRIMARY KEY,     -- 服务端字典ID
  source_platform     TEXT    NOT NULL DEFAULT 'global', -- 来源平台
  raw_name            TEXT    NOT NULL DEFAULT '', -- 英文游戏原名
  normalized_key      TEXT    NOT NULL DEFAULT '', -- 归一化匹配键
  normalized_key_hash TEXT    NOT NULL DEFAULT '', -- 归一化匹配键哈希
  chinese_name        TEXT    NOT NULL DEFAULT '', -- 中文显示名称
  is_deleted          INTEGER NOT NULL DEFAULT 0,  -- 是否删除
  updated_at          TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP -- 更新时间
);

CREATE INDEX IF NOT EXISTS idx_game_name_dict_source_hash
ON game_name_dict_alias (source_platform, normalized_key_hash);

CREATE INDEX IF NOT EXISTS idx_game_name_dict_lookup
ON game_name_dict_alias (source_platform, normalized_key_hash, normalized_key);

CREATE INDEX IF NOT EXISTS idx_game_name_dict_snapshot
ON game_name_dict_alias (is_deleted, id);

CREATE TABLE IF NOT EXISTS files
(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,      -- 自增主键ID
  module      int  NOT NULL,                          -- 0: mod, 1: app安装包
  type        TEXT NOT NULL,                          -- 文件类型
  version     TEXT NOT NULL,                          -- 版本号
  external_id int,                                    -- 外部关联ID
  file_path   TEXT NOT NULL,                          -- 文件存储路径
  md5         TEXT NOT NULL,                          -- 文件MD5值（32字符）
  create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP -- 创建时间
);

CREATE TABLE IF NOT EXISTS notifications
(
  id              INTEGER PRIMARY KEY,          -- 通知ID
  title           TEXT    NOT NULL,             -- 通知标题
  content         TEXT    NOT NULL,             -- 通知内容
  publishTime     TEXT    NOT NULL,             -- 发布时间
  expireTime      TEXT,                         -- 过期时间
  isTop           BOOLEAN NOT NULL DEFAULT 0,   -- 是否置顶（1-是，0-否）
  clickActionType INTEGER NOT NULL,             -- 点击动作类型
  targetUrl       TEXT,                         -- 点击跳转地址
  createdAt       TEXT    NOT NULL,             -- 记录创建时间
  isRead          BOOLEAN NOT NULL DEFAULT 1    -- 是否已读（1-是，0-否）
);

CREATE TABLE IF NOT EXISTS user_notifications
(
  id              INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  user_id         INTEGER NOT NULL,                  -- 用户ID
  notification_id INTEGER NOT NULL,                  -- 原始通知ID
  title           TEXT    NOT NULL,                  -- 通知标题
  content         TEXT    NOT NULL,                  -- 通知内容
  publishTime     TEXT    NOT NULL,                  -- 发布时间
  expireTime      TEXT,                              -- 过期时间
  isTop           BOOLEAN NOT NULL DEFAULT 0,        -- 是否置顶（1-是，0-否）
  clickActionType INTEGER NOT NULL,                  -- 点击动作类型
  targetUrl       TEXT,                              -- 点击跳转地址
  createdAt       TEXT    NOT NULL,                  -- 记录创建时间
  isRead          BOOLEAN NOT NULL DEFAULT 1,        -- 是否已读（1-是，0-否）
  UNIQUE (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS thunderstore_profiles
(
  id             INTEGER PRIMARY KEY AUTOINCREMENT, -- 自增主键ID
  game_id        INTEGER NOT NULL DEFAULT 0,        -- 关联游戏记录ID
  community      TEXT NOT NULL,                     -- 社区标识
  profile_name   TEXT NOT NULL,                     -- 配置名称
  package_loader TEXT DEFAULT '',                   -- 包加载器名称
  app_id         TEXT NOT NULL DEFAULT '',          -- 启动识别ID
  game_exe_path  TEXT DEFAULT '',                   -- 游戏可执行文件路径
  profile_root   TEXT NOT NULL,                     -- 配置根目录
  created_at     TEXT NOT NULL,                     -- 创建时间
  updated_at     TEXT NOT NULL,                     -- 更新时间
  UNIQUE (community, profile_name)
);

CREATE INDEX IF NOT EXISTS idx_thunderstore_profiles_game_id
ON thunderstore_profiles (game_id);

CREATE TABLE IF NOT EXISTS nexus_game_rule
(
  id            INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增主键ID
  nexus_game_id INTEGER NOT NULL,                    -- N网游戏ID
  game_id       INTEGER DEFAULT 0,                   -- 后端内部游戏ID
  domain_name   TEXT    DEFAULT '',                  -- 游戏域名标识
  rule_version  INTEGER NOT NULL,                    -- 规则版本号
  rule_json     TEXT    NOT NULL DEFAULT '{}',       -- 规则JSON文本
  source_type   TEXT    NOT NULL DEFAULT 'server',   -- 规则来源
  rule_checksum TEXT    DEFAULT '',                  -- 规则完整性校验和
  trust_level   TEXT    DEFAULT 'community',         -- 规则信任级别
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 更新时间
  UNIQUE (nexus_game_id, rule_version)
);

CREATE INDEX IF NOT EXISTS idx_nexus_game_rule_latest
ON nexus_game_rule (nexus_game_id, rule_version);

CREATE TABLE IF NOT EXISTS ai_translation_cache
(
  id              INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增主键ID
  cache_key       TEXT    NOT NULL UNIQUE,             -- 缓存唯一键
  source          TEXT    NOT NULL DEFAULT '',         -- 模组来源
  scene           TEXT    NOT NULL DEFAULT '',         -- 翻译场景
  item_kind       TEXT    NOT NULL DEFAULT 'text',     -- 文本类型
  provider_type   TEXT    NOT NULL DEFAULT '',         -- 供应商预设
  base_url        TEXT    NOT NULL DEFAULT '',         -- 请求地址
  model           TEXT    NOT NULL DEFAULT '',         -- 模型名称
  target_language TEXT    NOT NULL DEFAULT '',         -- 目标语言
  prompt_hash     TEXT    NOT NULL DEFAULT '',         -- 角色预设指纹
  text_hash       TEXT    NOT NULL DEFAULT '',         -- 原文指纹
  source_text     TEXT    NOT NULL DEFAULT '',         -- 原始文本
  translated_text TEXT    NOT NULL DEFAULT '',         -- 翻译结果
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 更新时间
);

CREATE INDEX IF NOT EXISTS idx_ai_translation_cache_lookup
ON ai_translation_cache (source, scene, model, target_language, item_kind);

CREATE TABLE IF NOT EXISTS app_config
(
  id           INTEGER PRIMARY KEY AUTOINCREMENT,   -- 自增主键ID
  config_key   TEXT NOT NULL UNIQUE,                -- 配置键（唯一）
  config_value TEXT NOT NULL,                       -- 配置值
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at   TIMESTAMP                            -- 更新时间
);

INSERT OR IGNORE INTO app_config (config_key, config_value)
VALUES ('db_version', '2.3.0');

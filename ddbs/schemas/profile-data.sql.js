module.exports = `
CREATE TABLE profiles (
  id INTEGER PRIMARY KEY NOT NULL,
  url TEXT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE vaults (
  profileId INTEGER NOT NULL,
  key TEXT NOT NULL,
  localPath TEXT, -- deprecated
  localSyncPath TEXT,
  isSaved INTEGER,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  autoDownload INTEGER DEFAULT 1,
  autoUpload INTEGER DEFAULT 1,
  networked INTEGER DEFAULT 1,
  expiresAt INTEGER
);

CREATE TABLE vaults_meta (
  key TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  forkOf TEXT, -- deprecated
  createdByUrl TEXT, -- deprecated
  createdByTitle TEXT, -- deprecated
  mtime INTEGER,
  metaSize INTEGER, -- deprecated
  stagingSize INTEGER, -- deprecated
  isOwner INTEGER,
  lastAccessTime INTEGER DEFAULT 0,
  lastRepositoryAccessTime INTEGER DEFAULT 0
);

CREATE TABLE vaults_meta_type (
  key TEXT,
  type TEXT
);

CREATE TABLE bookmarks (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  pinned INTEGER,
  pinOrder INTEGER DEFAULT 0,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  tags TEXT,
  notes TEXT,

  PRIMARY KEY (profileId, url),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

CREATE TABLE visits (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  ts INTEGER NOT NULL,

  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);
CREATE INDEX visits_url ON visits (url);

CREATE TABLE visit_stats (
  url TEXT NOT NULL,
  num_visits INTEGER,
  last_visit_ts INTEGER
);

CREATE VIRTUAL TABLE visit_fts USING fts4 (url, title);
CREATE UNIQUE INDEX visits_stats_url ON visit_stats (url);

-- list of the user's installed apps
-- deprecated
CREATE TABLE apps (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (profileId, name),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- log of the user's app installations
-- deprecated
CREATE TABLE apps_log (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  ts INTEGER DEFAULT (strftime('%s', 'now')),

  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- deprecated
CREATE TABLE workspaces (
  profileId INTEGER NOT NULL,
  name TEXT NOT NULL,
  localFilesPath TEXT,
  publishTargetUrl TEXT,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),
  updatedAt INTEGER DEFAULT (strftime('%s', 'now')),

  PRIMARY KEY (profileId, name),
  FOREIGN KEY (profileId) REFERENCES profiles (id) ON DELETE CASCADE
);

-- default profile
INSERT INTO profiles (id) VALUES (0);

-- default bookmarks
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dBrowser', 'dweb://dbrowser.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dPacks Repository', 'dweb://dpacks.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, '@DistributedWeb', 'https://twitter.com/distributedweb', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dHosting', 'https://dhosting.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dStatus', 'dweb://dstatus.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Report dBrowser Bugs', 'http://bugs.dbrowser.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dExplorer - Search The dWeb', 'dweb://dexplorer.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Donate To Project', 'https://donate.dwebs.io', 1);

PRAGMA user_version = 17;
`

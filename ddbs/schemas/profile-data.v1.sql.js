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
  isSaved INTEGER,
  createdAt INTEGER DEFAULT (strftime('%s', 'now'))
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
  isOwner INTEGER
);

CREATE TABLE bookmarks (
  profileId INTEGER,
  url TEXT NOT NULL,
  title TEXT,
  pinned INTEGER,
  createdAt INTEGER DEFAULT (strftime('%s', 'now')),

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

CREATE TABLE visit_stats (
  url TEXT NOT NULL,
  num_visits INTEGER,
  last_visit_ts INTEGER
);

CREATE VIRTUAL TABLE visit_fts USING fts4 (url, title);
CREATE UNIQUE INDEX visits_stats_url ON visit_stats (url);

-- default profile
INSERT INTO profiles (id) VALUES (0);

-- default bookmarks
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dBrowser', 'dweb://dbrowser.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dPacks Repository', 'dweb://dpacks.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, '@DistributedWeb', 'https://twitter.com/distributedweb', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dHosting', 'https://dhosting.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dStatus', 'dweb://dstatus.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Report an issue', 'http://bugs.dbrowser.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'dExplorer', 'dweb://dexplorer.io', 1);
INSERT INTO bookmarks (profileId, title, url, pinned) VALUES (0, 'Donate To Project', 'https://donate.dwebs.io', 1);

PRAGMA user_version = 1;
`

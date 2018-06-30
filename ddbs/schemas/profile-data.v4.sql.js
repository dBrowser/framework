module.exports = `

-- add flags to control swarming behaviors of vaults
ALTER TABLE vaults ADD COLUMN autoDownload INTEGER DEFAULT 1;
ALTER TABLE vaults ADD COLUMN autoUpload INTEGER DEFAULT 1;

PRAGMA user_version = 4;
`

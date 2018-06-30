module.exports = `

-- add a field to track the folder where an vault is being synced
ALTER TABLE vaults ADD COLUMN localSyncPath TEXT;

PRAGMA user_version = 17;
`

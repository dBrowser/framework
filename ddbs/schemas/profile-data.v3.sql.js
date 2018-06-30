module.exports = `

-- add variable to track the access times of vaults
ALTER TABLE vaults_meta ADD COLUMN lastAccessTime INTEGER DEFAULT 0;

PRAGMA user_version = 3;
`

module.exports = `

-- add a field to track when last accessed in the repository
ALTER TABLE vaults_meta ADD COLUMN lastRepositoryAccessTime INTEGER DEFAULT 0;

PRAGMA user_version = 13;
`

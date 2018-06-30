module.exports = `

-- add more flags to control swarming behaviors of vaults
ALTER TABLE vaults ADD COLUMN networked INTEGER DEFAULT 1;

PRAGMA user_version = 6;
`

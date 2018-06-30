module.exports = `

-- join table to list the vault's type fields
CREATE TABLE vaults_meta_type (
  key TEXT,
  type TEXT
);

PRAGMA user_version = 9;
`

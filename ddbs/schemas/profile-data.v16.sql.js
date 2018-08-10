module.exports = `

-- add a field to track when last accessed in the repository
ALTER TABLE bookmarks ADD COLUMN pinOrder INTEGER DEFAULT 0;

PRAGMA user_version = 16;
`

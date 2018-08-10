const path = require('path')
const url = require('url')
const mkdirp = require('mkdirp')
const Events = require('events')
const dwebCodec = require('@dwebs/codec')
const jetpack = require('fs-jetpack')
const {InvalidVaultKeyError} = require('@dbrowser/errors')
const db = require('./profile-data-db')
const lock = require('../lib/lock')
const {
  DWEB_HASH_REGEX,
  DWEB_GC_EXPIRATION_AGE
} = require('../lib/const')

// globals
// =

var dwebPath // path to the dPack folder
var events = new Events()

// exported methods
// =

exports.setup = function (opts) {
  // make sure the folders exist
  dwebPath = path.join(opts.userDataPath, 'DWeb')
  mkdirp.sync(path.join(dwebPath, 'Vaults'))
}

// get the path to an vault's files
const getVaultMetaPath = exports.getVaultMetaPath = function (vaultOrKey) {
  var key = dwebCodec.toStr(vaultOrKey.key || vaultOrKey)
  return path.join(dwebPath, 'Vaults', 'Meta', key.slice(0, 2), key.slice(2))
}

// delete all db entries and files for an vault
exports.deleteVault = async function (key) {
  const path = getVaultMetaPath(key)
  const info = await jetpack.inspectTreeAsync(path)
  await Promise.all([
    db.run(`DELETE FROM vaults WHERE key=?`, key),
    db.run(`DELETE FROM vaults_meta WHERE key=?`, key),
    db.run(`DELETE FROM vaults_meta_type WHERE key=?`, key),
    jetpack.removeAsync(path)
  ])
  return info.size
}

exports.on = events.on.bind(events)
exports.addListener = events.addListener.bind(events)
exports.removeListener = events.removeListener.bind(events)

// exported methods: vault user settings
// =

// get an array of saved vaults
// - optional `query` keys:
//   - `isSaved`: bool
//   - `isNetworked`: bool
//   - `isOwner`: bool, does dBrowser have the secret key?
exports.query = async function (profileId, query) {
  query = query || {}

  // fetch vault meta
  var values = []
  var WHERE = []
  if (query.isOwner === true) WHERE.push('vaults_meta.isOwner = 1')
  if (query.isOwner === false) WHERE.push('vaults_meta.isOwner = 0')
  if (query.isNetworked === true) WHERE.push('vaults.networked = 1')
  if (query.isNetworked === false) WHERE.push('vaults.networked = 0')
  if ('isSaved' in query) {
    if (query.isSaved) {
      WHERE.push('vaults.profileId = ?')
      values.push(profileId)
      WHERE.push('vaults.isSaved = 1')
    } else {
      WHERE.push('(vaults.isSaved = 0 OR vaults.isSaved IS NULL)')
    }
  }
  if ('type' in query) {
    WHERE.push('vaults_meta_type.type = ?')
    values.push(query.type)
  }
  if (WHERE.length) WHERE = `WHERE ${WHERE.join(' AND ')}`
  else WHERE = ''

  var vaults = await db.all(`
    SELECT
        vaults_meta.*,
        GROUP_CONCAT(vaults_meta_type.type) AS type,
        vaults.isSaved,
        vaults.networked,
        vaults.autoDownload,
        vaults.autoUpload,
        vaults.expiresAt,
        vaults.localSyncPath
      FROM vaults_meta
      LEFT JOIN vaults ON vaults.key = vaults_meta.key
      LEFT JOIN vaults_meta_type ON vaults_meta_type.key = vaults_meta.key
      ${WHERE}
      GROUP BY vaults_meta.key
  `, values)

  // massage the output
  vaults.forEach(vault => {
    vault.url = `dweb://${vault.key}`
    vault.isOwner = vault.isOwner != 0
    vault.type = vault.type ? vault.type.split(',') : []
    vault.userSettings = {
      isSaved: vault.isSaved != 0,
      networked: vault.networked != 0,
      autoDownload: vault.autoDownload != 0,
      autoUpload: vault.autoUpload != 0,
      expiresAt: vault.expiresAt,
      localSyncPath: vault.localSyncPath
    }

    // user settings
    delete vault.isSaved
    delete vault.networked
    delete vault.autoDownload
    delete vault.autoUpload
    delete vault.expiresAt
    delete vault.localSyncPath

    // old attrs
    delete vault.createdByTitle
    delete vault.createdByUrl
    delete vault.forkOf
    delete vault.metaSize
    delete vault.stagingSize
    delete vault.stagingSizeLessIgnored
  })
  return vaults
}

// get all vaults that should be unsaved
exports.listExpiredVaults = async function () {
  return db.all(`
    SELECT vaults.key
      FROM vaults
      WHERE
        vaults.isSaved = 1
        AND vaults.expiresAt != 0
        AND vaults.expiresAt IS NOT NULL
        AND vaults.expiresAt < ?
  `, [Date.now()])
}

// get all vaults that are ready for garbage collection
exports.listGarbageCollectableVaults = async function ({olderThan, isOwner} = {}) {
  olderThan = typeof olderThan === 'number' ? olderThan : DWEB_GC_EXPIRATION_AGE
  isOwner = typeof isOwner === 'boolean' ? `AND vaults_meta.isOwner = ${isOwner ? '1' : '0'}` : ''
  return db.all(`
    SELECT vaults_meta.key
      FROM vaults_meta
      LEFT JOIN vaults ON vaults_meta.key = vaults.key
      WHERE
        (vaults.isSaved != 1 OR vaults.isSaved IS NULL)
        AND vaults_meta.lastAccessTime < ?
        ${isOwner}
  `, [Date.now() - olderThan])
}

// upsert the last-access time
exports.touch = async function (key, timeVar = 'lastAccessTime', value = -1) {
  var release = await lock('vaults-db:meta')
  try {
    if (timeVar !== 'lastAccessTime' && timeVar !== 'lastRepositoryAccessTime') {
      timeVar = 'lastAccessTime'
    }
    if (value === -1) value = Date.now()
    key = dwebCodec.toStr(key)
    await db.run(`UPDATE vaults_meta SET ${timeVar}=? WHERE key=?`, [value, key])
    await db.run(`INSERT OR IGNORE INTO vaults_meta (key, ${timeVar}) VALUES (?, ?)`, [key, value])
  } finally {
    release()
  }
}

// get a single vault's user settings
// - supresses a not-found with an empty object
const getUserSettings = exports.getUserSettings = async function (profileId, key) {
  // massage inputs
  key = dwebCodec.toStr(key)

  // validate inputs
  if (!DWEB_HASH_REGEX.test(key)) {
    throw new InvalidVaultKeyError()
  }

  // fetch
  try {
    var settings = await db.get(`
      SELECT * FROM vaults WHERE profileId = ? AND key = ?
    `, [profileId, key])
    settings.isSaved = !!settings.isSaved
    settings.networked = !!settings.networked
    settings.autoDownload = !!settings.autoDownload
    settings.autoUpload = !!settings.autoUpload
    return settings
  } catch (e) {
    return {}
  }
}

// write an vault's user setting
exports.setUserSettings = async function (profileId, key, newValues = {}) {
  // massage inputs
  key = dwebCodec.toStr(key)

  // validate inputs
  if (!DWEB_HASH_REGEX.test(key)) {
    throw new InvalidVaultKeyError()
  }

  var release = await lock('vaults-db')
  try {
    // fetch current
    var value = await getUserSettings(profileId, key)

    if (!value || typeof value.key === 'undefined') {
      // create
      value = {
        profileId,
        key,
        isSaved: newValues.isSaved,
        networked: ('networked' in newValues) ? newValues.networked : true,
        autoDownload: ('autoDownload' in newValues) ? newValues.autoDownload : newValues.isSaved,
        autoUpload: ('autoUpload' in newValues) ? newValues.autoUpload : newValues.isSaved,
        expiresAt: newValues.expiresAt,
        localSyncPath: ('localSyncPath' in newValues) ? newValues.localSyncPath : ''
      }
      await db.run(`
        INSERT INTO vaults (profileId, key, isSaved, networked, autoDownload, autoUpload, expiresAt, localSyncPath) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [profileId, key, flag(value.isSaved), flag(value.networked), flag(value.autoDownload), flag(value.autoUpload), value.expiresAt, value.localSyncPath])
    } else {
      // update
      var { isSaved, networked, autoDownload, autoUpload, expiresAt, localSyncPath } = newValues
      if (typeof isSaved === 'boolean') value.isSaved = isSaved
      if (typeof networked === 'boolean') value.networked = networked
      if (typeof autoDownload === 'boolean') value.autoDownload = autoDownload
      if (typeof autoUpload === 'boolean') value.autoUpload = autoUpload
      if (typeof expiresAt === 'number') value.expiresAt = expiresAt
      if (typeof localSyncPath === 'string') value.localSyncPath = localSyncPath
      await db.run(`
        UPDATE vaults SET isSaved = ?, networked = ?, autoDownload = ?, autoUpload = ?, expiresAt = ?, localSyncPath = ? WHERE profileId = ? AND key = ?
      `, [flag(value.isSaved), flag(value.networked), flag(value.autoDownload), flag(value.autoUpload), value.expiresAt, value.localSyncPath, profileId, key])
    }

    events.emit('update:vault-user-settings', key, value, newValues)
    return value
  } finally {
    release()
  }
}

// exported methods: vault meta
// =

// get a single vault's metadata
// - supresses a not-found with an empty object
const getMeta = exports.getMeta = async function (key) {
  // massage inputs
  key = dwebCodec.toStr(key)

  // validate inputs
  if (!DWEB_HASH_REGEX.test(key)) {
    throw new InvalidVaultKeyError()
  }

  // fetch
  var meta = await db.get(`
    SELECT
        vaults_meta.*,
        GROUP_CONCAT(vaults_meta_type.type) AS type,
        GROUP_CONCAT(apps.name) as installedNames
      FROM vaults_meta
      LEFT JOIN vaults_meta_type ON vaults_meta_type.key = vaults_meta.key
      LEFT JOIN apps ON apps.url = ('dweb://' || vaults_meta.key)
      WHERE vaults_meta.key = ?
      GROUP BY vaults_meta.key
  `, [key])
  if (!meta) {
    return defaultMeta(key)
  }

  // massage some values
  meta.isOwner = !!meta.isOwner
  meta.type = meta.type ? meta.type.split(',') : []
  meta.installedNames = meta.installedNames ? meta.installedNames.split(',') : []

  // removeold attrs
  delete meta.createdByTitle
  delete meta.createdByUrl
  delete meta.forkOf
  delete meta.metaSize
  delete meta.stagingSize
  delete meta.stagingSizeLessIgnored

  return meta
}

// write an vault's metadata
exports.setMeta = async function (key, value = {}) {
  // massage inputs
  key = dwebCodec.toStr(key)

  // validate inputs
  if (!DWEB_HASH_REGEX.test(key)) {
    throw new InvalidVaultKeyError()
  }

  // extract the desired values
  var {title, description, type, mtime, isOwner} = value
  title = typeof title === 'string' ? title : ''
  description = typeof description === 'string' ? description : ''
  if (typeof type === 'string') type = type.split(' ')
  else if (Array.isArray(type)) type = type.filter(v => v && typeof v === 'string')
  isOwner = flag(isOwner)

  // write
  var release = await lock('vaults-db:meta')
  var {lastAccessTime, lastRepositoryAccessTime} = await getMeta(key)
  try {
    await db.run(`
      INSERT OR REPLACE INTO
        vaults_meta (key, title, description, mtime, isOwner, lastAccessTime, lastRepositoryAccessTime)
        VALUES        (?,   ?,     ?,           ?,     ?,       ?,              ?)
    `, [key, title, description, mtime, isOwner, lastAccessTime, lastRepositoryAccessTime])
    db.run(`DELETE FROM vaults_meta_type WHERE key=?`, key)
    if (type) {
      await Promise.all(type.map(t => (
        db.run(`INSERT INTO vaults_meta_type (key, type) VALUES (?, ?)`, [key, t])
      )))
    }
  } finally {
    release()
  }
  events.emit('update:vault-meta', key, value)
}

// internal methods
// =

function defaultMeta (key) {
  return {
    key,
    title: null,
    description: null,
    type: [],
    author: null,
    mtime: 0,
    isOwner: false,
    lastAccessTime: 0,
    installedNames: []
  }
}

function flag (b) {
  return b ? 1 : 0
}

exports.extractOrigin = function (originURL) {
  var urlp = url.parse(originURL)
  if (!urlp || !urlp.host || !urlp.protocol) return
  return (urlp.protocol + (urlp.slashes ? '//' : '') + urlp.host)
}

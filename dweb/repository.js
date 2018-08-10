const crypto = require('crypto')
const emitStream = require('emit-stream')
const EventEmitter = require('events')
const dwebCodec = require('@dwebs/codec')
const pify = require('pify')
const dwebapi = require('@dpack/api')
const signatures = require('sodium-signatures')
const parseDWebURL = require('@dwebs/parse')
const dWebStreams2 = require('@dwcore/dws2')
const split = require('split2')
const concat = require('@dwcore/dws-chain')
const CircularAppendFile = require('circular-append-file')
const debug = require('debug')('dpack')
const throttle = require('lodash.throttle')
const debounce = require('lodash.debounce')
const siteData = require('../ddbs/sitedata')
const settingsDb = require('../ddbs/settings')

// dPack modules
const vaultsDb = require('../ddbs/vaults')
const dwebGC = require('./garbage-collector')
const folderSync = require('./folder-sync')
const {addVaultFlockLogging} = require('./logging-utils')
const ddatabaseProtocol = require('@ddatabase/protocol')
const ddrive = require('@ddrive/core')

// network modules
const flockPresets = require('@flockcore/presets')
const flockRevelation = require('@flockcore/revelation')

// file modules
const mkdirp = require('mkdirp')

// constants
// =

const {
  DWEB_HASH_REGEX,
  DWEB_FLOCK_PORT,
  DWEB_PRESERVED_FIELDS_ON_FORK
} = require('../lib/const')
const {InvalidURLError} = require('@dbrowser/errors')

// globals
// =

var networkId = crypto.randomBytes(32)
var vaults = {} // in-memory cache of vault objects. key -> vault
var vaultsByDKey = {} // same, but revelationKey -> vault
var vaultLoadPromises = {} // key -> promise
var vaultsEvents = new EventEmitter()
var debugEvents = new EventEmitter()
var debugLogFile
var vaultFlock

// exported API
// =

exports.setup = function setup ({logfilePath}) {
  debugLogFile = CircularAppendFile(logfilePath, {maxSize: 1024 /* 1kb */ * 1024 /* 1mb */ * 10 /* 10mb */ })

  // wire up event handlers
  vaultsDb.on('update:vault-user-settings', async (key, userSettings, newUserSettings) => {
    // emit event
    var details = {
      url: 'dweb://' + key,
      isSaved: userSettings.isSaved,
      networked: userSettings.networked,
      autoDownload: userSettings.autoDownload,
      autoUpload: userSettings.autoUpload,
      localSyncPath: userSettings.localSyncPath
    }
    if ('isSaved' in newUserSettings) {
      vaultsEvents.emit(newUserSettings.isSaved ? 'added' : 'removed', {details})
    }

    // delete all perms for deleted vaults
    if (!userSettings.isSaved) {
      siteData.clearPermissionAllOrigins('modifyDWeb:' + key)
    }

    // update the download based on these settings
    var vault = getVault(key)
    if (vault) {
      configureNetwork(vault, userSettings)
      configureAutoDownload(vault, userSettings)
      configureLocalSync(vault, userSettings)
    }
  })
  folderSync.events.on('sync', (key, direction) => {
    vaultsEvents.emit('folder-synced', {
      details: {
        url: `dweb://${dwebCodec.toStr(key)}`,
        direction
      }
    })
  })
  folderSync.events.on('error', (key, err) => {
    vaultsEvents.emit('folder-sync-error', {
      details: {
        url: `dweb://${dwebCodec.toStr(key)}`,
        name: err.name,
        message: err.message
      }
    })
  })

  // setup the vault flock
  dwebGC.setup()
  vaultFlock = flockRevelation(flockPresets({
    id: networkId,
    hash: false,
    utp: true,
    tcp: true,
    dht: false,
    stream: createReplicationStream
  }))
  addVaultFlockLogging({vaultsByDKey, log, vaultFlock})
  vaultFlock.once('error', () => vaultFlock.listen(0))
  vaultFlock.listen(DWEB_FLOCK_PORT)

  // load and configure all saved vaults
  vaultsDb.query(0, {isSaved: true}).then(
    vaults => vaults.forEach(a => loadVault(a.key, a.userSettings)),
    err => console.error('Failed to load networked vaults', err)
  )
}

exports.createEventStream = function createEventStream () {
  return emitStream(vaultsEvents)
}

exports.getDebugLog = function getDebugLog (key) {
  return new Promise((resolve, reject) => {
    let rs = debugLogFile.createReadStream()
    rs
      .pipe(split())
      .pipe(dWebStreams2({encoding: 'utf8', decodeStrings: false}, (data, _, cb) => {
        if (data && data.startsWith(key)) {
          return cb(null, data.slice(key.length) + '\n')
        }
        cb()
      }))
      .pipe(concat({encoding: 'string'}, resolve))
    rs.on('error', reject)
  })
}

exports.createDebugStream = function createDebugStream () {
  return emitStream(debugEvents)
}

// read metadata for the vault, and store it in the meta db
const pullLatestVaultMeta = exports.pullLatestVaultMeta = async function pullLatestVaultMeta (vault, {updateMTime} = {}) {
  try {
    var key = vault.key.toString('hex')

    // ready() just in case (we need .blocks)
    await pify(vault.ready.bind(vault))()

    // read the vault meta and size on disk
    var [manifest, oldMeta] = await Promise.all([
      dwebapi.readManifest(vault).catch(_ => {}),
      vaultsDb.getMeta(key),
      updateSizeTracking(vault)
    ])
    manifest = vault.manifest = manifest || {}
    var {title, description, type} = manifest
    var isOwner = vault.writable
    var size = vault.size || 0
    var mtime = updateMTime ? Date.now() : oldMeta.mtime

    // write the record
    var details = {title, description, type, mtime, size, isOwner}
    debug('Writing meta', details)
    await vaultsDb.setMeta(key, details)

    // emit the updated event
    details.url = 'dweb://' + key
    vaultsEvents.emit('updated', {details})
    return details
  } catch (e) {
    console.error('Error pulling meta', e)
  }
}

// vault creation
// =

const createNewVault = exports.createNewVault = async function createNewVault (manifest = {}, settings = false) {
  var userSettings = {
    isSaved: true,
    networked: !(settings && settings.networked === false)
  }

  // create the vault
  var vault = await loadVault(null, userSettings)
  var key = dwebCodec.toStr(vault.key)

  // write the manifest and default dwebignore
  await Promise.all([
    dwebapi.writeManifest(vault, manifest),
    dwebapi.writeFile(vault, '/.dwebignore', await settingsDb.get('default_dweb_ignore'), 'utf8')
  ])

  // write the user settings
  await vaultsDb.setUserSettings(0, key, userSettings)

  // write the metadata
  await pullLatestVaultMeta(vault)

  return `dweb://${key}/`
}

exports.forkVault = async function forkVault (srcVaultUrl, manifest = {}, settings = false) {
  srcVaultUrl = fromKeyToURL(srcVaultUrl)

  // get the old vault
  var srcVault = getVault(srcVaultUrl)
  if (!srcVault) {
    throw new Error('Invalid vault key')
  }

  // fetch old vault meta
  var srcManifest = await dwebapi.readManifest(srcVault).catch(_ => {})
  srcManifest = srcManifest || {}

  // override any manifest data
  var dstManifest = {
    title: (manifest.title) ? manifest.title : srcManifest.title,
    description: (manifest.description) ? manifest.description : srcManifest.description,
    type: (manifest.type) ? manifest.type : srcManifest.type,
    author: manifest.author
  }
  DWEB_PRESERVED_FIELDS_ON_FORK.forEach(field => {
    if (srcManifest[field]) {
      dstManifest[field] = srcManifest[field]
    }
  })

  // create the new vault
  var dstVaultUrl = await createNewVault(dstManifest, settings)
  var dstVault = getVault(dstVaultUrl)

  // copy files
  var ignore = ['/.dweb', '/.git', '/dweb.json']
  await dwebapi.exportVaultToVault({
    srcVault,
    dstVault,
    skipUndownloadedFiles: true,
    ignore
  })

  // write a .dwebignore if DNE
  try {
    await dwebapi.stat(dstVault, '/.dwebignore')
  } catch (e) {
    await dwebapi.writeFile(dstVault, '/.dwebignore', await settingsDb.get('default_dweb_ignore'), 'utf8')
  }

  return dstVaultUrl
}

// vault management
// =

const loadVault = exports.loadVault = async function loadVault (key, userSettings = null) {
  // validate key
  var secretKey
  if (key) {
    if (!Buffer.isBuffer(key)) {
      // existing dat
      key = fromURLToKey(key)
      if (!DWEB_HASH_REGEX.test(key)) {
        throw new InvalidURLError()
      }
      key = dwebCodec.toBuf(key)
    }
  } else {
    // new dpack, generate keys
    var kp = signatures.keyPair()
    key = kp.publicKey
    secretKey = kp.secretKey
  }

  // fallback to the promise, if possible
  var keyStr = dwebCodec.toStr(key)
  if (keyStr in vaultLoadPromises) {
    return vaultLoadPromises[keyStr]
  }

  // run and cache the promise
  var p = loadVaultInner(key, secretKey, userSettings)
  vaultLoadPromises[keyStr] = p
  p.catch(err => {
    console.error('Failed to load vault', err)
  })

  // when done, clear the promise
  const clear = () => delete vaultLoadPromises[keyStr]
  p.then(clear, clear)

  return p
}

// main logic, separated out so we can capture the promise
async function loadVaultInner (key, secretKey, userSettings = null) {
  // load the user settings as needed
  if (!userSettings) {
    try {
      userSettings = await vaultsDb.getUserSettings(0, key)
    } catch (e) {
      userSettings = {networked: true}
    }
  }
  if (!('networked' in userSettings)) {
    userSettings.networked = true
  }

  // ensure the folders exist
  var metaPath = vaultsDb.getVaultMetaPath(key)
  mkdirp.sync(metaPath)

  // create the vault instance
  var vault = ddrive(metaPath, key, {
    sparse: true,
    secretKey,
    metadataStorageCacheSize: 0,
    contentStorageCacheSize: 0,
    treeCacheSize: 2048
  })
  vault.on('error', err => {
    console.error('Error in vault', key.toString('hex'), err)
    debug('Error in vault', key.toString('hex'), err)
  })
  vault.metadata.on('peer-add', () => onNetworkChanged(vault))
  vault.metadata.on('peer-remove', () => onNetworkChanged(vault))
  vault.replicationStreams = [] // list of all active replication streams
  vault.peerHistory = [] // samples of the peer count

  // wait for ready
  await new Promise((resolve, reject) => {
    vault.ready(err => {
      if (err) reject(err)
      else resolve()
    })
  })
  await updateSizeTracking(vault)
  vaultsDb.touch(key).catch(err => console.error('Failed to update lastAccessTime for vault', key, err))

  // store in the revelation listing, so the flocker can find it
  // but not yet in the regular vaults listing, because it's not fully loaded
  vaultsByDKey[dwebCodec.toStr(vault.revelationKey)] = vault

  // setup the vault based on current settings
  configureNetwork(vault, userSettings)
  configureAutoDownload(vault, userSettings)
  configureLocalSync(vault, userSettings)

  // await initial metadata sync if not the owner
  if (!vault.writable && !vault.metadata.length) {
    // wait to receive a first update
    await new Promise((resolve, reject) => {
      vault.metadata.update(err => {
        if (err) reject(err)
        else resolve()
      })
    })
  }
  if (!vault.writable) {
    // always download all metadata
    vault.metadata.download({start: 0, end: -1})
  }

  // pull meta
  await pullLatestVaultMeta(vault)

  // wire up events
  vault.pullLatestVaultMeta = debounce(opts => pullLatestVaultMeta(vault, opts), 1e3)
  vault.syncVaultToFolder = debounce((opts) => folderSync.syncVaultToFolder(vault, opts), 1e3)
  vault.fileActStream = dwebapi.watch(vault)
  vault.fileActStream.on('data', ([event, data]) => {
    if (event === 'changed') {
      vault.pullLatestVaultMeta({updateMTime: true})
      vault.syncVaultToFolder({shallow: false})
    }
  })
  vault.on('error', error => {
    log(vault.key.toString('hex'), {
      event: 'error',
      message: error.toString()
    })
  })

  // now store in main vaults listing, as loaded
  vaults[dwebCodec.toStr(vault.key)] = vault
  return vault
}

const getVault = exports.getVault = function getVault (key) {
  key = fromURLToKey(key)
  return vaults[key]
}

exports.getActiveVaults = function getActiveVaults () {
  return vaults
}

const getOrLoadVault = exports.getOrLoadVault = async function getOrLoadVault (key, opts) {
  var vault = getVault(key)
  if (vault) {
    return vault
  }
  return loadVault(key, opts)
}

exports.unloadVault = async function unloadVault (key) {
  key = fromURLToKey(key)
  const vault = vaults[key]
  if (!vault) {
    return
  }

  // shutdown vault
  leaveFlock(key)
  stopAutodownload(vault)
  if (vault.fileActStream) {
    vault.fileActStream.end()
    vault.fileActStream = null
  }
  await new Promise((resolve, reject) => {
    vault.close(err => {
      if (err) reject(err)
      else resolve()
    })
  })
  delete vaultsByDKey[dwebCodec.toStr(vault.revelationKey)]
  delete vaults[key]
}

const isVaultLoaded = exports.isVaultLoaded = function isVaultLoaded (key) {
  key = fromURLToKey(key)
  return key in vaults
}

const updateSizeTracking = exports.updateSizeTracking = async function updateSizeTracking (vault) {
  // fetch size
  vault.size = await dwebapi.readSize(vault, '/')
}

// vault fetch/query
// =

exports.queryVaults = async function queryVaults (query) {
  // run the query
  var vaultInfos = await vaultsDb.query(0, query)

  if (query && ('inMemory' in query)) {
    vaultInfos = vaultInfos.filter(vaultInfo => isVaultLoaded(vaultInfo.key) === query.inMemory)
  }

  // attach some live data
  vaultInfos.forEach(vaultInfo => {
    var vault = getVault(vaultInfo.key)
    if (vault) {
      vaultInfo.size = vault.size
      vaultInfo.peers = vault.metadata.peers.length
      vaultInfo.peerHistory = vault.peerHistory
    } else {
      vaultInfo.size = 0
      vaultInfo.peers = 0
      vaultInfo.peerHistory = []
    }
  })
  return vaultInfos
}

exports.getVaultInfo = async function getVaultInfo (key) {
  // get the vault
  key = fromURLToKey(key)
  var vault = await getOrLoadVault(key)

  // fetch vault data
  var [meta, userSettings] = await Promise.all([
    vaultsDb.getMeta(key),
    vaultsDb.getUserSettings(0, key)
  ])
  meta.key = key
  meta.url = `dweb://${key}`
  meta.links = vault.manifest.links || {}
  meta.manifest = vault.manifest
  meta.version = vault.version
  meta.size = vault.size
  meta.userSettings = {
    isSaved: userSettings.isSaved,
    networked: userSettings.networked,
    autoDownload: userSettings.autoDownload,
    autoUpload: userSettings.autoUpload,
    expiresAt: userSettings.expiresAt,
    localSyncPath: userSettings.localSyncPath
  }
  meta.peers = vault.metadata.peers.length
  meta.peerInfo = getVaultPeerInfos(vault)
  meta.peerHistory = vault.peerHistory

  return meta
}

exports.clearFileCache = async function clearFileCache (key) {
  var vault = await getOrLoadVault(key)
  if (vault.writable) {
    return // abort, only clear the content cache of downloaded vaults
  }

  // clear the cache
  await new Promise((resolve, reject) => {
    vault.content.clear(0, vault.content.length, err => {
      if (err) reject(err)
      else resolve()
    })
  })

  // force a reconfig of the autodownloader
  var userSettings = await vaultsDb.getUserSettings(0, key)
  stopAutodownload(vault)
  configureAutoDownload(vault, userSettings)
}

// vault networking
// =

// set the networking of an vault based on settings
function configureNetwork (vault, settings) {
  if (!settings || settings.networked) {
    joinFlock(vault)
  } else {
    leaveFlock(vault)
  }
}

// put the vault into the network, for upload and download
const joinFlock = exports.joinFlock = function joinFlock (key, opts) {
  var vault = (typeof key === 'object' && key.key) ? key : getVault(key)
  if (!vault || vault.isFlocking) return
  vaultFlock.join(vault.revelationKey)
  var keyStr = dwebCodec.toStr(vault.key)
  log(keyStr, {
    event: 'flocking',
    revelationKey: dwebCodec.toStr(vault.revelationKey)
  })
  vault.isFlocking = true
}

// take the vault out of the network
const leaveFlock = exports.leaveFlock = function leaveFlock (key) {
  var vault = (typeof key === 'object' && key.revelationKey) ? key : getVault(key)
  if (!vault || !vault.isFlocking) return

  var keyStr = dwebCodec.toStr(vault.key)
  log(keyStr, {
    event: 'unflocking',
    message: `Disconnected ${vault.metadata.peers.length} peers`
  })

  vault.replicationStreams.forEach(stream => stream.destroy()) // stop all active replications
  vault.replicationStreams.length = 0
  vaultFlock.leave(vault.revelationKey)
  vault.isFlocking = false
}

// helpers
// =

const fromURLToKey = exports.fromURLToKey = function fromURLToKey (url) {
  if (Buffer.isBuffer(url)) {
    return url
  }
  if (DWEB_HASH_REGEX.test(url)) {
    // simple case: given the key
    return url
  }

  var urlp = parseDWebURL(url)

  // validate
  if (urlp.protocol !== 'dweb:') {
    throw new InvalidURLError('URL must be a dweb: scheme')
  }
  if (!DWEB_HASH_REGEX.test(urlp.host)) {
    // TODO- support dns lookup?
    throw new InvalidURLError('Hostname is not a valid hash')
  }

  return urlp.host
}

const fromKeyToURL = exports.fromKeyToURL = function fromKeyToURL (key) {
  if (typeof key !== 'string') {
    key = dwebCodec.toStr(key)
  }
  if (!key.startsWith('dweb://')) {
    return `dweb://${key}/`
  }
  return key
}

// internal methods
// =

function configureAutoDownload (vault, userSettings) {
  if (vault.writable) {
    return // abort, only used for unwritable
  }
  // HACK
  // mafintosh is planning to put APIs for this inside of ddrive
  // till then, we'll do our own inefficient downloader
  // -prf
  const isAutoDownloading = userSettings.isSaved && userSettings.autoDownload
  if (!vault._autodownloader && isAutoDownloading) {
    // setup the autodownload
    vault._autodownloader = {
      undownloadAll: () => {
        if (vault.content) {
          vault.content._selections.forEach(range => vault.content.undownload(range))
        }
      },
      onUpdate: throttle(() => {
        // cancel ALL previous, then prioritize ALL current
        vault._autodownloader.undownloadAll()
        dwebapi.download(vault, '/').catch(e => { /* ignore cancels */ })
      }, 5e3)
    }
    vault.metadata.on('download', vault._autodownloader.onUpdate)
    dwebapi.download(vault, '/').catch(e => { /* ignore cancels */ })
  } else if (vault._autodownloader && !isAutoDownloading) {
    stopAutodownload(vault)
  }
}

function configureLocalSync (vault, userSettings) {
  let old = vault.localSyncPath
  vault.localSyncPath = userSettings.isSaved ? userSettings.localSyncPath : false

  if (vault.localSyncPath !== old) {
    // configure the local folder watcher if a change occurred
    folderSync.configureFolderToVaultWatcher(vault)
  }
}

function stopAutodownload (vault) {
  if (vault._autodownloader) {
    vault._autodownloader.undownloadAll()
    vault.metadata.removeListener('download', vault._autodownloader.onUpdate)
    vault._autodownloader = null
  }
}

function createReplicationStream (info) {
  // create the protocol stream
  var streamKeys = [] // list of keys replicated over the streamd
  var stream = ddatabaseProtocol({
    id: networkId,
    live: true,
    encrypt: true
  })
  stream.peerInfo = info

  // add the vault if the dWeb revelation network gave us any info
  if (info.channel) {
    add(info.channel)
  }

  // add any requested vaults
  stream.on('feed', add)

  function add (dkey) {
    // lookup the vault
    var dkeyStr = dwebCodec.toStr(dkey)
    var vault = vaultsByDKey[dkeyStr]
    if (!vault || !vault.isFlocking) {
      return
    }
    if (vault.replicationStreams.indexOf(stream) !== -1) {
      return // already replicating
    }

    // create the replication stream
    vault.replicate({stream, live: true})
    if (stream.destroyed) return // in case the stream was destroyed during setup

    // track the stream
    var keyStr = dwebCodec.toStr(vault.key)
    streamKeys.push(keyStr)
    vault.replicationStreams.push(stream)
    function onend () {
      vault.replicationStreams = vault.replicationStreams.filter(s => (s !== stream))
    }
    stream.once('error', onend)
    stream.once('end', onend)
    stream.once('close', onend)
  }

  // debugging
  stream.on('error', err => {
    log(streamKeys, {
      event: 'connection-error',
      peer: `${info.host}:${info.port}`,
      connectionType: info.type,
      message: err.toString()
    })
  })
  return stream
}

function onNetworkChanged (vault) {
  var now = Date.now()
  var lastHistory = vault.peerHistory.slice(-1)[0]
  if (lastHistory && (now - lastHistory.ts) < 10e3) {
    // if the last datapoint was < 10s ago, just update it
    lastHistory.peers = vault.metadata.peers.length
  } else {
    vault.peerHistory.push({
      ts: Date.now(),
      peers: vault.metadata.peers.length
    })
  }

  // keep peerHistory from getting too long
  if (vault.peerHistory.length >= 500) {
    // downsize to 360 points, which at 10s intervals covers one hour
    vault.peerHistory = vault.peerHistory.slice(vault.peerHistory.length - 360)
  }

  // count # of peers
  var totalPeerCount = 0
  for (var k in vaults) {
    totalPeerCount += vaults[k].metadata.peers.length
  }
  vaultsEvents.emit('network-changed', {
    details: {
      url: `dweb://${dwebCodec.toStr(vault.key)}`,
      peers: getVaultPeerInfos(vault),
      peerCount: vault.metadata.peers.length,
      totalPeerCount
    }
  })
}

function getVaultPeerInfos (vault) {
  // old way, more accurate?
  // vault.replicationStreams.map(s => ({host: s.peerInfo.host, port: s.peerInfo.port}))

  return vault.metadata.peers.map(peer => peer.stream.stream.peerInfo).filter(Boolean)
}

function log (key, data) {
  var keys = Array.isArray(key) ? key : [key]
  debug(Object.keys(data).reduce((str, key) => str + `${key}=${data[key]} `, '') + `key=${keys.join(',')}`)
  keys.forEach(k => debugEvents.emit(k, data))
  if (keys[0]) {
    debugLogFile.append(keys[0] + JSON.stringify(data) + '\n')
  }
}

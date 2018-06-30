const globals = require('../../../globals')
const _pick = require('lodash.pick')
const dws2 = require('@dwcore/dws2')
const dWebRepository = require('../../../dweb/repository')
const vaultsDb = require('../../../ddbs/vaults')
const {PermissionsError} = require('@dbrowser/errors')

// constants
// =

const API_DOCS_URL = 'https://TODO' // TODO
const API_PERM_ID = 'experimentalRepository'
const REQUEST_ADD_PERM_ID = 'experimentalRepositoryRequestAdd'
const REQUEST_REMOVE_PERM_ID = 'experimentalRepositoryRequestRemove'
const LAB_API_ID = 'repository'

const QUERY_FIELDS = ['inMemory', 'isSaved', 'isNetworked', 'isOwner']
const USER_SETTINGS_FIELDS = ['isSaved', 'expiresAt']
const VAULT_FIELDS = ['url', 'title', 'description', 'size', 'mtime', 'isOwner', 'userSettings', 'peers']
const EVENT_FIELDS = {
  added: ['url', 'isSaved'],
  removed: ['url', 'isSaved'],
  updated: ['url', 'title', 'description', 'size', 'mtime', 'isOwner'],
  'folder-synced': ['url', 'direction'],
  'network-changed': ['url', 'peerCount']
}

// exported api
// =

function add (isRequest) {
  return async function (url, {duration} = {}) {
    var key = dWebRepository.fromURLToKey(url)
    if (isRequest) await checkIsntOwner(key)
    await globals.permsAPI.checkLabsPerm({
      perm: isRequest ? `${REQUEST_ADD_PERM_ID}:${key}` : API_PERM_ID,
      labApi: LAB_API_ID,
      apiDocsUrl: API_DOCS_URL,
      sender: this.sender
    })

    // swarm the vault
    /* dont await */ dWebRepository.getOrLoadVault(key)

    // update settings
    var opts = {isSaved: true}
    if (duration && duration > 0) {
      opts.expiresAt = Date.now() + (duration * 60e3)
    }
    var settings = await vaultsDb.setUserSettings(0, key, opts)
    return _pick(settings, USER_SETTINGS_FIELDS)
  }
}

function remove (isRequest) {
  return async function (url) {
    var key = dWebRepository.fromURLToKey(url)
    if (isRequest) await checkIsntOwner(key)
    await globals.permsAPI.checkLabsPerm({
      perm: isRequest ? `${REQUEST_REMOVE_PERM_ID}:${key}` : API_PERM_ID,
      labApi: LAB_API_ID,
      apiDocsUrl: API_DOCS_URL,
      sender: this.sender
    })
    var settings = await vaultsDb.setUserSettings(0, key, {isSaved: false})
    return _pick(settings, USER_SETTINGS_FIELDS)
  }
}

module.exports = {

  add: add(false),
  requestAdd: add(true),

  remove: remove(false),
  requestRemove: remove(true),

  async get (url) {
    await globals.permsAPI.checkLabsPerm({
      perm: API_PERM_ID,
      labApi: LAB_API_ID,
      apiDocsUrl: API_DOCS_URL,
      sender: this.sender
    })
    var key = dWebRepository.fromURLToKey(url)
    var settings = await vaultsDb.getUserSettings(0, key)
    return _pick(settings, USER_SETTINGS_FIELDS)
  },

  async list (query = {}) {
    await globals.permsAPI.checkLabsPerm({
      perm: API_PERM_ID,
      labApi: LAB_API_ID,
      apiDocsUrl: API_DOCS_URL,
      sender: this.sender
    })
    var query = _pick(query, QUERY_FIELDS)
    var vaults = await dWebRepository.queryVaults(query)
    return vaults.map(a => {
      a = _pick(a, VAULT_FIELDS)
      a.userSettings = _pick(a.userSettings, USER_SETTINGS_FIELDS)
      return a
    })
  },

  async createEventStream () {
    await globals.permsAPI.checkLabsPerm({
      perm: API_PERM_ID,
      labApi: LAB_API_ID,
      apiDocsUrl: API_DOCS_URL,
      sender: this.sender
    })
    return dWebRepository.createEventStream().pipe(dws2.obj(function (event, enc, cb) {
      // only emit events that have a fields set
      var fields = EVENT_FIELDS[event[0]]
      if (fields) {
        event[1] = _pick(event[1].details, fields)
        this.push(event)
      }
      cb()
    }))
  }
}

// internal methods
// =

async function checkIsntOwner (key) {
  var meta = await vaultsDb.getMeta(key)
  if (meta.isOwner) throw new PermissionsError('Vault is owned by user')
}

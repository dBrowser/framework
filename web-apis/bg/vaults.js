const path = require('path')
const mkdirp = require('mkdirp')
const templatesDb = require('../../ddbs/templates')
const dwebDns = require('../../dweb/dns')
const folderSync = require('../../dweb/folder-sync')
const dWebRepository = require('../../dweb/repository')
const dwebGC = require('../../dweb/garbage-collector')
const vaultsDb = require('../../ddbs/vaults')
const {cbPromise} = require('../../lib/functions')
const {timer} = require('../../lib/time')

// exported api
// =

module.exports = {

  // system state
  // =

  async status () {
    var status = {vaults: 0, peers: 0}
    var vaults = dWebRepository.getActiveVaults()
    for (var k in vaults) {
      status.vaults++
      status.peers += vaults[k].metadata.peers.length
    }
    return status
  },

  // local cache management and querying
  // =

  async add (url, opts = {}) {
    var key = dWebRepository.fromURLToKey(url)

    // pull metadata
    var vault = await dWebRepository.getOrLoadVault(key)
    await dWebRepository.pullLatestVaultMeta(vault)

    // update settings
    opts.isSaved = true
    return vaultsDb.setUserSettings(0, key, opts)
  },

  async remove (url) {
    var key = dWebRepository.fromURLToKey(url)
    return vaultsDb.setUserSettings(0, key, {isSaved: false})
  },

  async bulkRemove (urls) {
    var results = []

    // sanity check
    if (!urls || !Array.isArray(urls)) {
      return []
    }

    for (var i = 0; i < urls.length; i++) {
      let key = dWebRepository.fromURLToKey(urls[i])

      results.push(await vaultsDb.setUserSettings(0, key, {isSaved: false}))
    }
    return results
  },

  async delete (url) {
    const key = dWebRepository.fromURLToKey(url)
    await vaultsDb.setUserSettings(0, key, {isSaved: false})
    await dWebRepository.unloadVault(key)
    const bytes = await vaultsDb.deleteVault(key)
    return {bytes}
  },

  async list (query = {}) {
    return dWebRepository.queryVaults(query)
  },

  // folder sync
  // =

  async validateLocalSyncPath (key, localSyncPath) {
    key = dWebRepository.fromURLToKey(key)
    localSyncPath = path.normalize(localSyncPath)

    // make sure the path is good
    try {
      await folderSync.assertSafePath(localSyncPath)
    } catch (e) {
      if (e.notFound) {
        return {doesNotExist: true}
      }
      throw e
    }

    // check for conflicts
    var vault = await dWebRepository.getOrLoadVault(key)
    var diff = await folderSync.diffListing(vault, {localSyncPath})
    diff = diff.filter(d => d.change === 'mod' && d.path !== '/dweb.json')
    if (diff.length) {
      return {hasConflicts: true, conflicts: diff.map(d => d.path)}
    }

    return {}
  },

  async setLocalSyncPath (key, localSyncPath, opts = {}) {
    key = dWebRepository.fromURLToKey(key)
    localSyncPath = localSyncPath ? path.normalize(localSyncPath) : null

    // disable path
    if (!localSyncPath) {
      await vaultsDb.setUserSettings(0, key, {localSyncPath: ''})
      return
    }

    // load the vault
    await timer(3e3, async (checkin) => { // put a max 3s timeout on loading the dPack
      checkin('searching for dPack')
      await dWebRepository.getOrLoadVault(key)
    })

    // make sure the path is good
    try {
      await folderSync.assertSafePath(localSyncPath)
    } catch (e) {
      if (e.notFound) {
        // just create the folder
        await cbPromise(cb => mkdirp(localSyncPath, cb))
      } else {
        throw e
      }
    }

    // update the record
    await vaultsDb.setUserSettings(0, key, {localSyncPath})
  },

  // templates
  // =

  async getTemplate (url) {
    return templatesDb.get(0, url)
  },

  async listTemplates () {
    return templatesDb.list(0)
  },

  async putTemplate (url, {title, screenshot}) {
    return templatesDb.put(0, url, {title, screenshot})
  },

  async removeTemplate (url) {
    return templatesDb.remove(0, url)
  },

  // internal management
  // =

  async touch (key, timeVar, value) {
    return vaultsDb.touch(key, timeVar, value)
  },

  async clearFileCache (url) {
    return dWebRepository.clearFileCache(dWebRepository.fromURLToKey(url))
  },

  async clearGarbage ({isOwner} = {}) {
    return dwebGC.collect({olderThan: 0, biggerThan: 0, isOwner})
  },

  clearDnsCache () {
    dwebDns.flushCache()
  },

  // events
  // =

  createEventStream () {
    return dWebRepository.createEventStream()
  },

  getDebugLog (key) {
    return dWebRepository.getDebugLog(key)
  },

  createDebugStream () {
    return dWebRepository.createDebugStream()
  }
}

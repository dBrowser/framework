const vaultsDb = require('../ddbs/vaults')
const {unloadVault} = require('./repository')
const {
  DWEB_GC_FIRST_COLLECT_WAIT,
  DWEB_GC_REGULAR_COLLECT_WAIT
} = require('../lib/const')
const debug = require('debug')('dwebgc')

// globals
// =

var nextGCTimeout

// exported API
// =

exports.setup = function () {
  schedule(DWEB_GC_FIRST_COLLECT_WAIT)
}

const collect = exports.collect = async function ({olderThan, isOwner} = {}) {
  // clear any scheduled GC
  if (nextGCTimeout) {
    clearTimeout(nextGCTimeout)
    nextGCTimeout = null
  }

  // run the GC
  var totalBytes = 0
  var skippedVaults = 0
  var startTime = Date.now()

  // first unsave expired vaults
  var expiredVaults = await vaultsDb.listExpiredVaults()
  debug('GC unsaving %d expired vaults', expiredVaults.length)
  var promises = []
  for (let i = 0; i < expiredVaults.length; i++) {
    promises.push(vaultsDb.setUserSettings(0, expiredVaults[i].key, {isSaved: false}))
  }
  await Promise.all(promises)

  // now GC old vaults
  var unusedVaults = await vaultsDb.listGarbageCollectableVaults({olderThan, isOwner})
  debug('GC cleaning out %d unused vaults', unusedVaults.length)
  for (let i = 0; i < unusedVaults.length; i++) {
    await unloadVault(unusedVaults[i].key)
    totalBytes += await vaultsDb.deleteVault(unusedVaults[i].key)
  }

  debug('GC completed in %d ms', Date.now() - startTime)

  // schedule the next GC
  schedule(DWEB_GC_REGULAR_COLLECT_WAIT)

  // return stats
  return {totalBytes, totalVaults: unusedVaults.length - skippedVaults, skippedVaults}
}

// helpers
// =

function schedule (time) {
  nextGCTimeout = setTimeout(collect, time)
  nextGCTimeout.unref()
}

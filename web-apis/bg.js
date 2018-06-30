const globals = require('../globals')

const SECURE_ORIGIN_REGEX = /^(bench:|dweb:|https:|http:\/\/localhost(\/|:))/i

// internal manifests
const dBrowserManifest = require('./manifests/internal/browser')
const bookmarksManifest = require('./manifests/internal/bookmarks')
const downloadsManifest = require('./manifests/internal/downloads')
const sitedataManifest = require('./manifests/internal/sitedata')
const vaultsManifest = require('./manifests/internal/vaults')
const historyManifest = require('./manifests/internal/history')

// internal apis
const vaultsAPI = require('./bg/vaults')
const bookmarksAPI = require('./bg/bookmarks')
const historyAPI = require('./bg/history')
const sitedataAPI = require('../ddbs/sitedata').WEBAPI

// external manifests
const dpackVaultManifest = require('./manifests/external/dpack-vault')

// external apis
const dpackVaultAPI = require('./bg/dpack-vault')

// experimental manifests
const experimentalRepositoryManifest = require('./manifests/external/experimental/repository')
const experimentalGlobalFetchManifest = require('./manifests/external/experimental/global-fetch')

// experimental apis
const experimentalRepositoryAPI = require('./bg/experimental/repository')
const experimentalGlobalFetchAPI = require('./bg/experimental/global-fetch')

// exported api
// =

exports.setup = function () {
  // internal apis
  globals.rpcAPI.exportAPI('vaults', vaultsManifest, vaultsAPI, internalOnly)
  globals.rpcAPI.exportAPI('bookmarks', bookmarksManifest, bookmarksAPI, internalOnly)
  globals.rpcAPI.exportAPI('history', historyManifest, historyAPI, internalOnly)
  globals.rpcAPI.exportAPI('sitedata', sitedataManifest, sitedataAPI, internalOnly)
  globals.rpcAPI.exportAPI('downloads', downloadsManifest, globals.downloadsWebAPI, internalOnly)
  globals.rpcAPI.exportAPI('dbrowser', dBrowserManifest, globals.browserWebAPI, internalOnly)

  // external apis
  globals.rpcAPI.exportAPI('dpack-vault', dpackVaultManifest, dpackVaultAPI, secureOnly)

  // experimental apis
  globals.rpcAPI.exportAPI('experimental-repository', experimentalRepositoryManifest, experimentalRepositoryAPI, secureOnly)
  globals.rpcAPI.exportAPI('experimental-global-fetch', experimentalGlobalFetchManifest, experimentalGlobalFetchAPI, secureOnly)
}

function internalOnly (event, methodName, args) {
  return (event && event.sender && event.sender.getURL().startsWith('bench:'))
}

function secureOnly (event, methodName, args) {
  if (!(event && event.sender)) {
    return false
  }
  var url = event.sender.getURL()
  return SECURE_ORIGIN_REGEX.test(url)
}

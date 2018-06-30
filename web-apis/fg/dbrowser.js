const {EventTarget, bindEventStream, fromEventStream} = require('./event-target')
const errors = require('@dbrowser/errors')

const vaultsManifest = require('../manifests/internal/vaults')
const bookmarksManifest = require('../manifests/internal/bookmarks')
const historyManifest = require('../manifests/internal/history')
const downloadsManifest = require('../manifests/internal/downloads')
const sitedataManifest = require('../manifests/internal/sitedata')
const dBrowserManifest = require('../manifests/internal/browser')

exports.setup = function (rpc) {
  const dbrowser = {}
  const opts = {timeout: false, errors}

  // internal only
  if (window.location.protocol === 'bench:') {
    const historyRPC = rpc.importAPI('history', historyManifest, opts)
    const bookmarksRPC = rpc.importAPI('bookmarks', bookmarksManifest, opts)
    const vaultsRPC = rpc.importAPI('vaults', vaultsManifest, opts)
    const downloadsRPC = rpc.importAPI('downloads', downloadsManifest, opts)
    const sitedataRPC = rpc.importAPI('sitedata', sitedataManifest, opts)
    const dBrowserRPC = rpc.importAPI('dbrowser', dBrowserManifest, opts)

    // dbrowser.bookmarks
    dbrowser.bookmarks = {}
    dbrowser.bookmarks.getBookmark = bookmarksRPC.getBookmark
    dbrowser.bookmarks.isBookmarked = bookmarksRPC.isBookmarked
    dbrowser.bookmarks.bookmarkPublic = bookmarksRPC.bookmarkPublic
    dbrowser.bookmarks.unbookmarkPublic = bookmarksRPC.unbookmarkPublic
    dbrowser.bookmarks.listPublicBookmarks = bookmarksRPC.listPublicBookmarks
    dbrowser.bookmarks.setBookmarkPinned = bookmarksRPC.setBookmarkPinned
    dbrowser.bookmarks.setBookmarkPinOrder = bookmarksRPC.setBookmarkPinOrder
    dbrowser.bookmarks.listPinnedBookmarks = bookmarksRPC.listPinnedBookmarks
    dbrowser.bookmarks.bookmarkPrivate = bookmarksRPC.bookmarkPrivate
    dbrowser.bookmarks.unbookmarkPrivate = bookmarksRPC.unbookmarkPrivate
    dbrowser.bookmarks.listPrivateBookmarks = bookmarksRPC.listPrivateBookmarks
    dbrowser.bookmarks.listBookmarkTags = bookmarksRPC.listBookmarkTags

    // dbrowser.vaults
    dbrowser.vaults = new EventTarget()
    dbrowser.vaults.status = vaultsRPC.status
    dbrowser.vaults.add = vaultsRPC.add
    dbrowser.vaults.remove = vaultsRPC.remove
    dbrowser.vaults.bulkRemove = vaultsRPC.bulkRemove
    dbrowser.vaults.delete = vaultsRPC.delete
    dbrowser.vaults.list = vaultsRPC.list
    dbrowser.vaults.validateLocalSyncPath = vaultsRPC.validateLocalSyncPath
    dbrowser.vaults.setLocalSyncPath = vaultsRPC.setLocalSyncPath
    dbrowser.vaults.getTemplate = vaultsRPC.getTemplate
    dbrowser.vaults.listTemplates = vaultsRPC.listTemplates
    dbrowser.vaults.putTemplate = vaultsRPC.putTemplate
    dbrowser.vaults.removeTemplate = vaultsRPC.removeTemplate
    dbrowser.vaults.touch = vaultsRPC.touch
    dbrowser.vaults.clearFileCache = vaultsRPC.clearFileCache
    dbrowser.vaults.clearGarbage = vaultsRPC.clearGarbage
    dbrowser.vaults.clearDnsCache = vaultsRPC.clearDnsCache
    dbrowser.vaults.getDebugLog = vaultsRPC.getDebugLog
    dbrowser.vaults.createDebugStream = () => fromEventStream(vaultsRPC.createDebugStream())
    try {
      bindEventStream(vaultsRPC.createEventStream(), dbrowser.vaults)
    } catch (e) {
      // permissions error
    }

    // dbrowser.history
    dbrowser.history = {}
    dbrowser.history.addVisit = historyRPC.addVisit
    dbrowser.history.getVisitHistory = historyRPC.getVisitHistory
    dbrowser.history.getMostVisited = historyRPC.getMostVisited
    dbrowser.history.search = historyRPC.search
    dbrowser.history.removeVisit = historyRPC.removeVisit
    dbrowser.history.removeAllVisits = historyRPC.removeAllVisits
    dbrowser.history.removeVisitsAfter = historyRPC.removeVisitsAfter

    // dbrowser.downloads
    dbrowser.downloads = {}
    dbrowser.downloads.getDownloads = downloadsRPC.getDownloads
    dbrowser.downloads.pause = downloadsRPC.pause
    dbrowser.downloads.resume = downloadsRPC.resume
    dbrowser.downloads.cancel = downloadsRPC.cancel
    dbrowser.downloads.remove = downloadsRPC.remove
    dbrowser.downloads.open = downloadsRPC.open
    dbrowser.downloads.showInFolder = downloadsRPC.showInFolder
    dbrowser.downloads.createEventsStream = () => fromEventStream(downloadsRPC.createEventsStream())

    // dbrowser.sitedata
    dbrowser.sitedata = {}
    dbrowser.sitedata.get = sitedataRPC.get
    dbrowser.sitedata.set = sitedataRPC.set
    dbrowser.sitedata.getPermissions = sitedataRPC.getPermissions
    dbrowser.sitedata.getAppPermissions = sitedataRPC.getAppPermissions
    dbrowser.sitedata.getPermission = sitedataRPC.getPermission
    dbrowser.sitedata.setPermission = sitedataRPC.setPermission
    dbrowser.sitedata.setAppPermissions = sitedataRPC.setAppPermissions
    dbrowser.sitedata.clearPermission = sitedataRPC.clearPermission
    dbrowser.sitedata.clearPermissionAllOrigins = sitedataRPC.clearPermissionAllOrigins

    // dbrowser.browser
    dbrowser.browser = {}
    dbrowser.browser.createEventsStream = () => fromEventStream(dBrowserRPC.createEventsStream())
    dbrowser.browser.getInfo = dBrowserRPC.getInfo
    dbrowser.browser.checkForUpdates = dBrowserRPC.checkForUpdates
    dbrowser.browser.restartBrowser = dBrowserRPC.restartBrowser
    dbrowser.browser.getSetting = dBrowserRPC.getSetting
    dbrowser.browser.getSettings = dBrowserRPC.getSettings
    dbrowser.browser.setSetting = dBrowserRPC.setSetting
    dbrowser.browser.getUserSetupStatus = dBrowserRPC.getUserSetupStatus
    dbrowser.browser.setUserSetupStatus = dBrowserRPC.setUserSetupStatus
    dbrowser.browser.getDefaultLocalPath = dBrowserRPC.getDefaultLocalPath
    dbrowser.browser.setStartPageBackgroundImage = dBrowserRPC.setStartPageBackgroundImage
    dbrowser.browser.getDefaultProtocolSettings = dBrowserRPC.getDefaultProtocolSettings
    dbrowser.browser.setAsDefaultProtocolClient = dBrowserRPC.setAsDefaultProtocolClient
    dbrowser.browser.removeAsDefaultProtocolClient = dBrowserRPC.removeAsDefaultProtocolClient
    dbrowser.browser.fetchBody = dBrowserRPC.fetchBody
    dbrowser.browser.downloadURL = dBrowserRPC.downloadURL
    dbrowser.browser.listBuiltinFavicons = dBrowserRPC.listBuiltinFavicons
    dbrowser.browser.getBuiltinFavicon = dBrowserRPC.getBuiltinFavicon
    dbrowser.browser.setWindowDimensions = dBrowserRPC.setWindowDimensions
    dbrowser.browser.showOpenDialog = dBrowserRPC.showOpenDialog
    dbrowser.browser.showContextMenu = dBrowserRPC.showContextMenu
    dbrowser.browser.openUrl = dBrowserRPC.openUrl
    dbrowser.browser.openFolder = dBrowserRPC.openFolder
    dbrowser.browser.doWebcontentsCmd = dBrowserRPC.doWebcontentsCmd
    dbrowser.browser.doTest = dBrowserRPC.doTest
    dbrowser.browser.closeModal = dBrowserRPC.closeModal
  }

  return dbrowser
}

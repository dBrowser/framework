const globals = require('../../globals')
const path = require('path')
const fs = require('fs')
const parseDWebURL = require('@dwebs/parse')
const dwebapi = require('@dpack/api')
const concat = require('@dwcore/dws-chain')
const pick = require('lodash.pick')
const dwebDns = require('../../dweb/dns')
const dWebRepository = require('../../dweb/repository')
const vaultsDb = require('../../ddbs/vaults')
const {timer} = require('../../lib/time')
const {
  DWEB_MANIFEST_FILENAME,
  DWEB_CONFIGURABLE_FIELDS,
  DWEB_HASH_REGEX,
  DWEB_QUOTA_DEFAULT_BYTES_ALLOWED,
  DWEB_VALID_PATH_REGEX,
  DEFAULT_DWEB_API_TIMEOUT
} = require('../../lib/const')
const {
  PermissionsError,
  UserDeniedError,
  QuotaExceededError,
  VaultNotWritableError,
  InvalidURLError,
  ProtectedFileNotWritableError,
  InvalidPathError
} = require('@dbrowser/errors')

// exported api
// =

const to = (opts) =>
  (opts && typeof opts.timeout !== 'undefined')
    ? opts.timeout
    : DEFAULT_DWEB_API_TIMEOUT

module.exports = {
  async createVault ({title, description, type, networked, links, template, prompt} = {}) {
    var newVaultUrl

    // only allow type, networked, and template to be set by dBrowser, for now
    if (!this.sender.getURL().startsWith('bench:')) {
      type = networked = template = undefined
    }

    if (prompt !== false) {
      // run the creation modal
      let res
      try {
        res = await globals.uiAPI.showModal(this.sender, 'create-vault', {title, description, type, networked, links})
      } catch (e) {
        if (e.name !== 'Error') {
          throw e // only rethrow if a specific error
        }
      }
      if (!res || !res.url) throw new UserDeniedError()
      newVaultUrl = res.url
    } else {
      // no modal, ask for permission
      await assertCreateVaultPermission(this.sender)

      // create
      let author = await getAuthor()
      newVaultUrl = await dWebRepository.createNewVault({title, description, type, author, links}, {networked})
    }
    let newVaultKey = await lookupUrlDWebKey(newVaultUrl)

    // apply the template
    if (template) {
      try {
        let vault = dWebRepository.getVault(newVaultKey)
        let templatePath = path.join(__dirname, 'assets', 'templates', template)
        await dwebapi.exportFilesystemToVault({
          srcPath: templatePath,
          dstVault: vault,
          dstPath: '/',
          inplaceImport: true
        })
      } catch (e) {
        console.error('Failed to import template', e)
      }
    }

    // grant write permissions to the creating app
    globals.permsAPI.grantPermission('modifyDWeb:' + newVaultKey, this.sender.getURL())
    return newVaultUrl
  },

  async forkVault (url, {title, description, type, networked, links, prompt} = {}) {
    var newVaultUrl

    // only allow type and networked to be set by dBrowser, for now
    if (!this.sender.getURL().startsWith('bench:')) {
      type = networked = undefined
    }

    if (prompt !== false) {
      // run the fork modal
      let key1 = await lookupUrlDWebKey(url)
      let key2 = await lookupUrlDWebKey(this.sender.getURL())
      let isSelfFork = key1 === key2
      let res
      try {
        res = await globals.uiAPI.showModal(this.sender, 'fork-vault', {url, title, description, type, networked, links, isSelfFork})
      } catch (e) {
        if (e.name !== 'Error') {
          throw e // only rethrow if a specific error
        }
      }
      if (!res || !res.url) throw new UserDeniedError()
      newVaultUrl = res.url
    } else {
      // no modal, ask for permission
      await assertCreateVaultPermission(this.sender)

      // create
      let author = await getAuthor()
      newVaultUrl = await dWebRepository.forkVault(url, {title, description, type, author, links}, {networked})
    }

    // grant write permissions to the creating app
    let newVaultKey = await lookupUrlDWebKey(newVaultUrl)
    globals.permsAPI.grantPermission('modifyDWeb:' + newVaultKey, this.sender.getURL())
    return newVaultUrl
  },

  async unlinkVault (url) {
    var {vault} = await lookupVault(url)
    await assertDeleteVaultPermission(vault, this.sender)
    await assertVaultDeletable(vault)
    await vaultsDb.setUserSettings(0, vault.key, {isSaved: false})
  },

  async loadVault (url) {
    if (!url || typeof url !== 'string') {
      return Promise.reject(new InvalidURLError())
    }
    url = await dwebDns.resolveName(url)
    await dWebRepository.getOrLoadVault(url)
    return Promise.resolve(true)
  },

  async getInfo (url, opts = {}) {
    return timer(to(opts), async () => {
      var info = await dWebRepository.getVaultInfo(url)

      // request from dBrowser internal sites: give all data
      if (this.sender.getURL().startsWith('bench:')) {
        // check that the local sync path is valid
        if (info && info.userSettings.localSyncPath) {
          const stat = await new Promise(resolve => {
            fs.stat(info.userSettings.localSyncPath, (_, st) => resolve(st))
          })
          if (!stat || !stat.isDirectory()) {
            info.localSyncPathIsMissing = true
            info.missingLocalSyncPath = info.userSettings.localSyncPath // store on other attr
            info.userSettings.localSyncPath = undefined // unset to avoid accidents
          }
        }
        return info
      }

      // request from userland: return a subset of the data
      return {
        key: info.key,
        url: info.url,
        isOwner: info.isOwner,
        // networked: info.userSettings.networked,

        // state
        version: info.version,
        peers: info.peers,
        mtime: info.mtime,
        size: info.size,

        // manifest
        title: info.title,
        description: info.description,
        // type: info.type
        links: info.links
      }
    })
  },

  async configure (url, settings, opts) {
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('looking up vault')

      var {vault, version} = await lookupVault(url, opts)
      if (version) throw new VaultNotWritableError('Cannot modify a historic version')
      if (!settings || typeof settings !== 'object') throw new Error('Invalid argument')

      // handle 'networked' specially
      // also, only allow dBrowser to set 'networked' for now
      if (('networked' in settings) && this.sender.getURL().startsWith('bench:')) {
        if (settings.networked === false) {
          await assertVaultOfflineable(vault)
        }
        await vaultsDb.setUserSettings(0, vault.key, {networked: settings.networked, expiresAt: 0})
      }

      // manifest updates
      let manifestUpdates = pick(settings, DWEB_CONFIGURABLE_FIELDS)
      if (Object.keys(manifestUpdates).length === 0) {
        // no manifest updates
        return
      }

      pause() // dont count against timeout, there may be user prompts
      var senderOrigin = vaultsDb.extractOrigin(this.sender.getURL())
      await assertWritePermission(vault, this.sender)
      await assertQuotaPermission(vault, senderOrigin, Buffer.byteLength(JSON.stringify(settings), 'utf8'))
      resume()

      checkin('updating vault')
      await dwebapi.updateManifest(vault, manifestUpdates)
      await dWebRepository.pullLatestVaultMeta(vault)
    })
  },

  async history (url, opts = {}) {
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('looking up vault')

      var reverse = opts.reverse === true
      var {start, end} = opts
      var {vault, checkoutFS} = await lookupVault(url, opts)

      checkin('reading history')

      // if reversing the output, modify start/end
      start = start || 0
      end = end || vault.metadata.length
      if (reverse) {
        // swap values
        let t = start
        start = end
        end = t
        // start from the end
        start = vault.metadata.length - start
        end = vault.metadata.length - end
      }

      return new Promise((resolve, reject) => {
        var stream = checkoutFS.history({live: false, start, end})
        stream.pipe(concat({encoding: 'object'}, values => {
          values = values.map(massageHistoryObj)
          if (reverse) values.reverse()
          resolve(values)
        }))
        stream.on('error', reject)
      })
    })
  },

  async stat (url, filepath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('looking up vault')
      const {checkoutFS} = await lookupVault(url, opts)
      checkin('stating file')
      return dwebapi.stat(checkoutFS, filepath)
    })
  },

  async readFile (url, filepath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('looking up vault')
      const {checkoutFS} = await lookupVault(url, opts)
      checkin('reading file')
      return dwebapi.readFile(checkoutFS, filepath, opts)
    })
  },

  async writeFile (url, filepath, data, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('looking up vault')
      const {vault, version} = await lookupVault(url, opts)
      if (version) throw new VaultNotWritableError('Cannot modify a historic version')

      pause() // dont count against timeout, there may be user prompts
      const senderOrigin = vaultsDb.extractOrigin(this.sender.getURL())
      await assertWritePermission(vault, this.sender)
      const sourceSize = Buffer.byteLength(data, opts.encoding)
      await assertQuotaPermission(vault, senderOrigin, sourceSize)
      assertValidFilePath(filepath)
      assertUnprotectedFilePath(filepath, this.sender)
      resume()

      checkin('writing file')
      return dwebapi.writeFile(vault, filepath, data, opts)
    })
  },

  async unlink (url, filepath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('looking up vault')
      const {vault, version} = await lookupVault(url)
      if (version) throw new VaultNotWritableError('Cannot modify a historic version')

      pause() // dont count against timeout, there may be user prompts
      await assertWritePermission(vault, this.sender)
      assertUnprotectedFilePath(filepath, this.sender)
      resume()

      checkin('deleting file')
      return dwebapi.unlink(vault, filepath)
    })
  },

  async copy (url, filepath, dstpath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('searching for vault')
      const {vault} = await lookupVault(url)

      pause() // dont count against timeout, there may be user prompts
      const senderOrigin = vaultsDb.extractOrigin(this.sender.getURL())
      await assertWritePermission(vault, this.sender)
      assertUnprotectedFilePath(dstpath, this.sender)
      const sourceSize = await dwebapi.readSize(vault, filepath)
      await assertQuotaPermission(vault, senderOrigin, sourceSize)
      resume()

      checkin('copying file')
      return dwebapi.copy(vault, filepath, dstpath)
    })
  },

  async rename (url, filepath, dstpath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('searching for vault')
      const {vault} = await lookupVault(url)

      pause() // dont count against timeout, there may be user prompts
      await assertWritePermission(vault, this.sender)
      assertValidFilePath(dstpath)
      assertUnprotectedFilePath(filepath, this.sender)
      assertUnprotectedFilePath(dstpath, this.sender)
      resume()

      checkin('renaming file')
      return dwebapi.rename(vault, filepath, dstpath)
    })
  },

  async download (url, filepath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('searching for vault')
      const {vault, version} = await lookupVault(url)
      if (version) throw new Error('Not yet supported: can\'t download() old versions yet. Sorry!') // TODO
      if (vault.writable) {
        return // no need to download
      }

      checkin('downloading file')
      return dwebapi.download(vault, filepath)
    })
  },

  async readdir (url, filepath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('searching for vault')
      const {checkoutFS} = await lookupVault(url, opts)

      checkin('reading directory')
      var names = await dwebapi.readdir(checkoutFS, filepath, opts)
      if (opts.stat) {
        for (let i = 0; i < names.length; i++) {
          names[i] = {
            name: names[i],
            stat: await dwebapi.stat(checkoutFS, path.join(filepath, names[i]))
          }
        }
      }
      return names
    })
  },

  async mkdir (url, filepath, opts) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('searching for vault')
      const {vault, version} = await lookupVault(url)
      if (version) throw new VaultNotWritableError('Cannot modify a historic version')

      pause() // dont count against timeout, there may be user prompts
      await assertWritePermission(vault, this.sender)
      await assertValidPath(filepath)
      assertUnprotectedFilePath(filepath, this.sender)
      resume()

      checkin('making directory')
      return dwebapi.mkdir(vault, filepath)
    })
  },

  async rmdir (url, filepath, opts = {}) {
    filepath = normalizeFilepath(filepath || '')
    return timer(to(opts), async (checkin, pause, resume) => {
      checkin('searching for vault')
      const {vault, version} = await lookupVault(url, opts)
      if (version) throw new VaultNotWritableError('Cannot modify a historic version')

      pause() // dont count against timeout, there may be user prompts
      await assertWritePermission(vault, this.sender)
      assertUnprotectedFilePath(filepath, this.sender)
      resume()

      checkin('removing directory')
      return dwebapi.rmdir(vault, filepath, opts)
    })
  },

  async watch (url, pathPattern) {
    var {vault} = await lookupVault(url)
    return dwebapi.watch(vault, pathPattern)
  },

  async createNetworkActivityStream (url) {
    var {vault} = await lookupVault(url)
    return dwebapi.createNetworkActivityStream(vault)
  },

  async resolveName (name) {
    if (DWEB_HASH_REGEX.test(name)) return name
    return dwebDns.resolveName(name)
  },

  async selectVault ({title, buttonLabel, filters} = {}) {
    // initiate the modal
    var res
    try {
      res = await globals.uiAPI.showModal(this.sender, 'select-vault', {title, buttonLabel, filters})
    } catch (e) {
      if (e.name !== 'Error') {
        throw e // only rethrow if a specific error
      }
    }
    if (!res || !res.url) throw new UserDeniedError()
    return res.url
  },

  async diff (srcUrl, dstUrl, opts) {
    assertTmpDBrowserOnly(this.sender)
    if (!srcUrl || typeof srcUrl !== 'string') {
      throw new InvalidURLError('The first parameter of diff() must be a dWeb URL')
    }
    if (!dstUrl || typeof dstUrl !== 'string') {
      throw new InvalidURLError('The second parameter of diff() must be a dWeb URL')
    }
    var [src, dst] = await Promise.all([lookupVault(srcUrl), lookupVault(dstUrl)])
    return dwebapi.diff(src.vault, src.filepath, dst.vault, dst.filepath, opts)
  },

  async merge (srcUrl, dstUrl, opts) {
    assertTmpDBrowserOnly(this.sender)
    if (!srcUrl || typeof srcUrl !== 'string') {
      throw new InvalidURLError('The first parameter of merge() must be a dWeb URL')
    }
    if (!dstUrl || typeof dstUrl !== 'string') {
      throw new InvalidURLError('The second parameter of merge() must be a dWeb URL')
    }
    var [src, dst] = await Promise.all([lookupVault(srcUrl), lookupVault(dstUrl)])
    if (!dst.vault.writable) throw new VaultNotWritableError('The destination vault is not writable')
    if (dst.version) throw new VaultNotWritableError('Cannot modify a historic version')
    return dwebapi.merge(src.vault, src.filepath, dst.vault, dst.filepath, opts)
  },

  async importFromFilesystem (opts) {
    assertTmpDBrowserOnly(this.sender)
    var {vault, filepath, version} = await lookupVault(opts.dst, opts)
    if (version) throw new VaultNotWritableError('Cannot modify a historic version')
    return dwebapi.exportFilesystemToVault({
      srcPath: opts.src,
      dstVault: vault,
      dstPath: filepath,
      ignore: opts.ignore,
      inplaceImport: opts.inplaceImport !== false
    })
  },

  async exportToFilesystem (opts) {
    assertTmpDBrowserOnly(this.sender)

    // TODO do we need to replace this? -prf
    // if (await checkFolderIsEmpty(opts.dst) === false) {
    // return
    // }

    var {checkoutFS, filepath} = await lookupVault(opts.src, opts)
    return dwebapi.exportVaultToFilesystem({
      srcVault: checkoutFS,
      srcPath: filepath,
      dstPath: opts.dst,
      ignore: opts.ignore,
      overwriteExisting: opts.overwriteExisting,
      skipUndownloadedFiles: opts.skipUndownloadedFiles !== false
    })
  },

  async exportToVault (opts) {
    assertTmpDBrowserOnly(this.sender)
    var src = await lookupVault(opts.src, opts)
    var dst = await lookupVault(opts.dst, opts)
    if (dst.version) throw new VaultNotWritableError('Cannot modify a historic version')
    return dwebapi.exportVaultToVault({
      srcVault: src.checkoutFS,
      srcPath: src.filepath,
      dstVault: dst.vault,
      dstPath: dst.filepath,
      ignore: opts.ignore,
      skipUndownloadedFiles: opts.skipUndownloadedFiles !== false
    })
  }
}

// internal helpers
// =

// helper to check if filepath refers to a file that userland is not allowed to edit directly
function assertUnprotectedFilePath (filepath, sender) {
  if (sender.getURL().startsWith('bench:')) {
    return // can write any file
  }
  if (filepath === '/' + DWEB_MANIFEST_FILENAME) {
    throw new ProtectedFileNotWritableError()
  }
}

// temporary helper to make sure the call is made by a bench: page
function assertTmpDBrowserOnly (sender) {
  if (!sender.getURL().startsWith('bench:')) {
    throw new PermissionsError()
  }
}

async function assertCreateVaultPermission (sender) {
  // bench: always allowed
  if (sender.getURL().startsWith('bench:')) {
    return true
  }

  // ask the user
  let allowed = await globals.permsAPI.requestPermission('createDWeb', sender)
  if (!allowed) {
    throw new UserDeniedError()
  }
}

async function assertWritePermission (vault, sender) {
  var vaultKey = vault.key.toString('hex')
  var details = await dWebRepository.getVaultInfo(vaultKey)
  const perm = ('modifyDWeb:' + vaultKey)

  // ensure we have the vault's private key
  if (!vault.writable) {
    throw new VaultNotWritableError()
  }

  // ensure we havent deleted the vault
  if (!details.userSettings.isSaved) {
    throw new VaultNotWritableError('This vault has been deleted. Restore it to continue making changes.')
  }

  // bench: always allowed
  if (sender.getURL().startsWith('bench:')) {
    return true
  }

  // self-modification ALWAYS allowed
  var senderDWebKey = await lookupUrlDWebKey(sender.getURL())
  if (senderDWebKey === vaultKey) {
    return true
  }

  // ensure the sender is allowed to write
  var allowed = await globals.permsAPI.queryPermission(perm, sender)
  if (allowed) return true

  // ask the user
  allowed = await globals.permsAPI.requestPermission(perm, sender, { title: details.title })
  if (!allowed) throw new UserDeniedError()
  return true
}

async function assertDeleteVaultPermission (vault, sender) {
  var vaultKey = vault.key.toString('hex')
  const perm = ('deleteDWeb:' + vaultKey)

  // bench: always allowed
  if (sender.getURL().startsWith('bench:')) {
    return true
  }

  // ask the user
  var details = await dWebRepository.getVaultInfo(vaultKey)
  var allowed = await globals.permsAPI.requestPermission(perm, sender, { title: details.title })
  if (!allowed) throw new UserDeniedError()
  return true
}

async function assertVaultOfflineable (vault) {
  // TODO(profiles) disabled -prf
  // var profileRecord = await getProfileRecord(0)
  // if ('dweb://' + vault.key.toString('hex') === profileRecord.url) {
  //   throw new PermissionsError('Unable to set the user vault to offline.')
  // }
}

async function assertVaultDeletable (vault) {
  // TODO(profiles) disabled -prf
  // var profileRecord = await getProfileRecord(0)
  // if ('dweb://' + vault.key.toString('hex') === profileRecord.url) {
  //   throw new PermissionsError('Unable to delete the user vault.')
  // }
}

async function assertQuotaPermission (vault, senderOrigin, byteLength) {
  // bench: always allowed
  if (senderOrigin.startsWith('bench:')) {
    return
  }

  // fetch the vault settings
  const userSettings = await vaultsDb.getUserSettings(0, vault.key)

  // fallback to default quota
  var bytesAllowed = userSettings.bytesAllowed || DWEB_QUOTA_DEFAULT_BYTES_ALLOWED

  // update the vault size
  await dWebRepository.updateSizeTracking(vault)

  // check the new size
  var newSize = (vault.size + byteLength)
  if (newSize > bytesAllowed) {
    throw new QuotaExceededError()
  }
}

function assertValidFilePath (filepath) {
  if (filepath.slice(-1) === '/') {
    throw new InvalidPathError('Files can not have a trailing slash')
  }
  assertValidPath(filepath)
}

function assertValidPath (fileOrFolderPath) {
  if (!DWEB_VALID_PATH_REGEX.test(fileOrFolderPath)) {
    throw new InvalidPathError('Path contains invalid characters')
  }
}

// async function assertSenderIsFocused (sender) {
//   if (!sender.isFocused()) {
//     throw new UserDeniedError('Application must be focused to spawn a prompt')
//   }
// }

async function getAuthor () {
  return undefined
  // TODO(profiles) disabled -prf
  // var profileRecord = await getProfileRecord(0)
  // if (!profileRecord || !profileRecord.url) return undefined
  // var profile = await getProfilesAPI().getProfile(profileRecord.url)
  // return {
  //   url: profileRecord.url,
  //   name: profile && profile.name ? profile.name : undefined
  // }
}

async function parseUrlParts (url) {
  var vaultKey, filepath, version
  if (DWEB_HASH_REGEX.test(url)) {
    // simple case: given the key
    vaultKey = url
    filepath = '/'
  } else {
    var urlp = parseDWebURL(url)

    // validate
    if (urlp.protocol !== 'dweb:') {
      throw new InvalidURLError('URL must be a dweb: scheme')
    }
    if (!DWEB_HASH_REGEX.test(urlp.host)) {
      urlp.host = await dwebDns.resolveName(url)
    }

    vaultKey = urlp.host
    filepath = decodeURIComponent(urlp.pathname || '') || '/'
    version = urlp.version
  }
  return {vaultKey, filepath, version}
}

function normalizeFilepath (str) {
  str = decodeURIComponent(str)
  if (str.charAt(0) !== '/') {
    str = '/' + str
  }
  return str
}

// helper to handle the URL argument that's given to most args
// - can get a dPack hash, or dWeb URL
// - returns {vault, filepath, version}
// - sets vault.checkoutFS to what's requested by version
// - throws if the filepath is invalid
async function lookupVault (url, opts = {}) {
  // lookup the vault
  var {vaultKey, filepath, version} = await parseUrlParts(url)
  var vault = dWebRepository.getVault(vaultKey)
  if (!vault) vault = await dWebRepository.loadVault(vaultKey)

  // set checkoutFS according to the version requested
  var checkoutFS = (version)
    ? vault.checkout(+version, {metadataStorageCacheSize: 0, contentStorageCacheSize: 0, treeCacheSize: 0})
    : vault

  return {vault, filepath, version, checkoutFS}
}

async function lookupUrlDWebKey (url) {
  if (url.startsWith('dweb://') === false) {
    return false // not a dSite
  }

  var urlp = parseDWebURL(url)
  try {
    return await dwebDns.resolveName(urlp.hostname)
  } catch (e) {
    return false
  }
}

function massageHistoryObj ({name, version, type}) {
  return {path: name, version, type}
}

const globals = require('../globals')
const bytes = require('bytes')
const dft = require('diff-file-tree')
const diff = require('diff')
const anymatch = require('anymatch')
const fs = require('fs')
const path = require('path')
const EventEmitter = require('events')
const dwebapi = require('@dpack/api')
const settingsDb = require('../ddbs/settings')
const {isFileNameBinary, isFileContentBinary} = require('../lib/mime')
const scopedFSes = require('../lib/scoped-fses')
const {
  NotFoundError,
  NotAFolderError,
  ProtectedFileNotWritableError,
  VaultNotWritableError,
  InvalidEncodingError,
  SourceTooLargeError
} = require('@dbrowser/errors')

const MAX_DIFF_SIZE = bytes('1mb')

// exported api
// =

const events = exports.events = new EventEmitter()

// distribute dPack to the folder
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the vault localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
exports.syncVaultToFolder = function (vault, opts = {}) {
  // dont run if a folder->vault sync is happening due to a detected change
  if (vault.syncFolderToVaultTimeout) return console.log('Not running, locked')

  return sync(vault, false, opts)
}

// distribute folder to the dPack
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the vault localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
const syncFolderToVault = exports.syncFolderToVault = function (vault, opts = {}) {
  if (!vault.writable) throw new VaultNotWritableError()
  return sync(vault, true, opts)
}

// attach/detach a watcher on the local folder and sync it to the dPack
exports.configureFolderToVaultWatcher = async function (vault) {
  console.log('configureFolderToVaultWatcher()', vault.localSyncPath, !!vault.stopWatchingLocalFolder)
  var wasWatching = !!vault.stopWatchingLocalFolder

  if (vault.stopWatchingLocalFolder) {
    // stop watching
    vault.stopWatchingLocalFolder()
    vault.stopWatchingLocalFolder = null
  }

  if (vault.localSyncPath) {
    // make sure the folder exists
    let st = await stat(fs, vault.localSyncPath)
    if (!st) {
      console.error('Local sync folder not found, aborting watch', vault.localSyncPath)
    }

    // sync up if just starting
    if (!wasWatching) {
      try {
        await mergeVaultAndFolder(vault, vault.localSyncPath)
      } catch (e) {
        console.error('Failed to merge local sync folder', e)
      }
    }

    // start watching
    var isSyncing = false
    var scopedFS = scopedFSes.get(vault.localSyncPath)
    vault.stopWatchingLocalFolder = scopedFS.watch('/', path => {
      // TODO
      // it would be possible to make this more efficient by ignoring changes that match .dwebignore
      // but you need to make sure you have the latest .dwebignore and reading that on every change-event isnt efficient
      // so you either need to:
      //  A. queue up all the changed paths, then read the dwebignore inside the timeout and filter, if filteredList.length === 0 then abort
      //  B. maintain an in-memory copy of the dwebignore and keep it up-to-date, and then check at time of the event
      // -prf

      console.log('changed detected', path)
      // ignore if currently syncing
      if (isSyncing) return console.log('already syncing, ignored')
      // debounce the handler
      if (vault.syncFolderToVaultTimeout) {
        clearTimeout(vault.syncFolderToVaultTimeout)
      }
      vault.syncFolderToVaultTimeout = setTimeout(async () => {
        console.log('ok timed out')
        isSyncing = true
        try {
          // await runBuild(vault)
          let st = await stat(fs, vault.localSyncPath)
          if (!st) {
            // folder has been removed
            vault.stopWatchingLocalFolder()
            vault.stopWatchingLocalFolder = null
            console.error('Local sync folder not found, aborting watch', vault.localSyncPath)
            return
          }
          await syncFolderToVault(vault, {shallow: false})
        } catch (e) {
          console.error('Error syncing folder', vault.localSyncPath, e)
          if (e.name === 'CycleError') {
            events.emit('error', vault.key, e)
          }
        } finally {
          isSyncing = false
          vault.syncFolderToVaultTimeout = null
        }
      }, 500)
    })
  }
}

// list the files that differ
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the vault localSyncPath
exports.diffListing = async function (vault, opts = {}) {
  var localSyncPath = opts.localSyncPath || vault.localSyncPath
  if (!localSyncPath) return // sanity check
  var scopedFS = scopedFSes.get(localSyncPath)
  opts = massageDiffOpts(opts)

  // build ignore rules
  if (opts.paths) {
    opts.filter = makeDiffFilterByPaths(opts.paths)
  } else {
    const ignoreRules = await readDWebIgnore(scopedFS)
    opts.filter = (filepath) => anymatch(ignoreRules, filepath)
  }

  // run diff
  return dft.diff({fs: scopedFS}, {fs: vault}, opts)
}

// diff an individual file
// - filepath: string, the path of the file in the vault/folder
exports.diffFile = async function (vault, filepath) {
  if (!vault.localSyncPath) return // sanity check
  var scopedFS = scopedFSes.get(vault.localSyncPath)
  filepath = path.normalize(filepath)

  // check the filename to see if it's binary
  var isBinary = isFileNameBinary(filepath)
  if (isBinary === true) {
    throw new InvalidEncodingError('Cannot diff a binary file')
  }

  // make sure we can handle the buffers involved
  let st
  st = await stat(scopedFS, filepath)
  if (isBinary !== false && st && st.isFile() && await isFileContentBinary(scopedFS, filepath)) {
    throw new InvalidEncodingError('Cannot diff a binary file')
  }
  if (st && st.isFile() && st.size > MAX_DIFF_SIZE) {
    throw new SourceTooLargeError()
  }
  st = await stat(vault, filepath)
  if (isBinary !== false && st && st.isFile() && await isFileContentBinary(vault, filepath)) {
    throw new InvalidEncodingError('Cannot diff a binary file')
  }
  if (st && st.isFile() && st.size > MAX_DIFF_SIZE) {
    throw new SourceTooLargeError()
  }

  // read the file in both sources
  const [newFile, oldFile] = await Promise.all([readFile(scopedFS, filepath), readFile(vault, filepath)])

  // return the diff
  return diff.diffLines(oldFile, newFile)
}

// validate a path to be used for sync
exports.assertSafePath = async function (p) {
  // check whether this is an OS path
  for (let disallowedSavePath of globals.disallowedSavePaths) {
    if (path.normalize(p) === path.normalize(disallowedSavePath)) {
      throw new ProtectedFileNotWritableError(`This is a protected folder. Please pick another folder or subfolder.`)
    }
  }

  // stat the folder
  const stat = await new Promise(resolve => {
    fs.stat(p, (_, st) => resolve(st))
  })

  if (!stat) {
    throw new NotFoundError()
  }

  if (!stat.isDirectory()) {
    throw new NotAFolderError('Invalid target folder: not a folder')
  }
}

// read a dwebignore from a fs space and turn it into anymatch rules
const readDWebIgnore = exports.readDWebIgnore = async function (fs) {
  var rulesRaw = await readFile(fs, '.dwebignore')
  if (!rulesRaw) {
    // TODO remove this? we're supposed to only use .dwebignore but many vaults wont have one at first -prf
    rulesRaw = await settingsDb.get('default_dweb_ignore')
  }
  return rulesRaw.split('\n')
    .filter(Boolean)
    .map(rule => {
      if (!rule.startsWith('/')) {
        rule = '**/' + rule
      }
      return rule
    })
    .concat(['/.git', '/.dweb'])
    .map(path.normalize)
}

// merge the dweb.json in the folder and then merge files, with preference to folder files
const mergeVaultAndFolder = exports.mergeVaultAndFolder = async function (vault, localSyncPath) {
  console.log('merging vault with', localSyncPath)
  const readManifest = async (fs) => {
    try { return await dwebapi.readManifest(fs) } catch (e) { return {} }
  }
  var localFS = scopedFSes.get(localSyncPath)
  var localManifest = await readManifest(localFS)
  var vaultManifest = await readManifest(vault)
  var mergedManifest = Object.assign(vaultManifest || {}, localManifest || {})
  await dwebapi.writeManifest(localFS, mergedManifest)
  await sync(vault, false, {localSyncPath, shallow: false, addOnly: true}) // vault -> folder (add-only)
  await sync(vault, true, {localSyncPath, shallow: false}) // folder -> vault
  console.log('done merging vault with', localSyncPath)
}

// internal methods
// =

// distribute the dPack & folder content
// - toVault: true to sync folder to vault, false to sync vault to folder
// - opts
//   - shallow: bool, dont descend into changed folders (default true)
//   - compareContent: bool, compare the actual content (default true)
//   - paths: Array<string>, a whitelist of files to compare
//   - localSyncPath: string, override the vault localSyncPath
//   - addOnly: bool, dont modify or remove any files (default false)
async function sync (vault, toVault, opts = {}) {
  var localSyncPath = opts.localSyncPath || vault.localSyncPath
  if (!localSyncPath) return // sanity check
  var scopedFS = scopedFSes.get(localSyncPath)
  opts = massageDiffOpts(opts)

  // build ignore rules
  if (opts.paths) {
    opts.filter = makeDiffFilterByPaths(opts.paths)
  } else {
    let ignoreRules = await readDWebIgnore(scopedFS)
    opts.filter = (filepath) => anymatch(ignoreRules, filepath)
  }

  // choose direction
  var left = toVault ? {fs: scopedFS} : {fs: vault}
  var right = toVault ? {fs: vault} : {fs: scopedFS}

  // run diff
  var diff = await dft.diff(left, right, opts)
  if (opts.addOnly) {
    diff = diff.filter(d => d.change === 'add')
  }
  console.log('syncing to', toVault ? 'vault' : 'folder', diff) // DEBUG

  // sync data
  await dft.applyRight(left, right, diff)
  events.emit('sync', vault.key, toVault ? 'vault' : 'folder')
}

// run the build-step, if npm and the package.json are setup
// async function runBuild (vault) {
//   var localSyncPath = vault.localSyncPath
//   if (!localSyncPath) return // sanity check
//   var scopedFS = scopedFSes.get(localSyncPath)

//   // read the package.json
//   var packageJson
//   try { packageJson = JSON.parse(await readFile(scopedFS, '/package.json')) } catch (e) { return /* abort */ }

//   // make sure there's a watch-build script
//   var watchBuildScript = _get(packageJson, 'scripts.watch-build')
//   if (typeof watchBuildScript !== 'string') return

//   // run the build script
//   var res
//   try {
//     console.log('running watch-build')
//     res = await exec('npm run watch-build', {cwd: localSyncPath})
//   } catch (e) {
//     res = e
//   }
//   await new Promise(r => scopedFS.writeFile(WATCH_BUILD_LOG_PATH, res, () => r()))
// }

function makeDiffFilterByPaths (targetPaths) {
  targetPaths = targetPaths.map(path.normalize)
  return (filepath) => {
    for (let i = 0; i < targetPaths.length; i++) {
      let targetPath = targetPaths[i]

      if (targetPath.endsWith(path.sep)) {
        // a directory
        if (filepath === targetPath.slice(0, -1)) return false // the directory itself
        if (filepath.startsWith(targetPath)) return false // a file within the directory
      } else {
        // a file
        if (filepath === targetPath) return false
      }
      if (targetPath.startsWith(filepath) && targetPath.charAt(filepath.length) === '/') {
        return false // a parent folder
      }
    }
    return true
  }
}

function massageDiffOpts (opts) {
  return {
    compareContent: typeof opts.compareContent === 'boolean' ? opts.compareContent : true,
    shallow: typeof opts.shallow === 'boolean' ? opts.shallow : true,
    paths: Array.isArray(opts.paths) ? opts.paths.filter(v => typeof v === 'string') : false,
    addOnly: typeof opts.addOnly === 'boolean' ? opts.addOnly : false
  }
}

// helper to read a file via promise and return a null on fail
async function stat (fs, filepath) {
  return new Promise(resolve => {
    fs.stat(filepath, (_, data) => {
      resolve(data || null)
    })
  })
}

// helper to read a file via promise and return an empty string on fail
async function readFile (fs, filepath) {
  return new Promise(resolve => {
    fs.readFile(filepath, {encoding: 'utf8'}, (_, data) => {
      resolve(data || '')
    })
  })
}

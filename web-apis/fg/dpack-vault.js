const errors = require('@dbrowser/errors')
const parseDWebURL = require('@dwebs/parse')
const dpackVaultManifest = require('../manifests/external/dpack-vault')
const {EventTarget, Event, fromEventStream} = require('./event-target')
const Stat = require('./stat')

const LOAD_PROMISE = Symbol('LOAD_PROMISE')
const URL_PROMISE = Symbol('URL_PROMISE')
const NETWORK_ACT_STREAM = Symbol() // eslint-disable-line

exports.setup = function (rpc) {
  // create the rpc apis
  const dWebRPC = rpc.importAPI('dpack-vault', dpackVaultManifest, { timeout: false, errors })

  class DPackVault extends EventTarget {
    constructor (url) {
      super()
      var errStack = (new Error()).stack

      // simple case: new DPackVault(window.location)
      if (url === window.location) {
        url = window.location.toString()
      }

      // basic URL validation
      if (!url || typeof url !== 'string') {
        throwWithFixedStack(new Error('Invalid dweb:// URL'), errStack)
      }

      // parse the URL
      const urlParsed = parseDWebURL(url)
      if (!urlParsed || (urlParsed.protocol !== 'dweb:')) {
        throwWithFixedStack(new Error('Invalid URL: must be a dweb:// URL'), errStack)
      }
      url = 'dweb://' + urlParsed.hostname + (urlParsed.version ? `+${urlParsed.version}` : '')

      // load into the 'active' (in-memory) cache
      setHidden(this, LOAD_PROMISE, dWebRPC.loadVault(url))

      // resolve the URL (DNS)
      const urlPromise = DPackVault.resolveName(url).then(url => {
        if (urlParsed.version) {
          url += `+${urlParsed.version}`
        }
        return 'dweb://' + url
      })
      setHidden(this, URL_PROMISE, urlPromise)

      // define this.url as a frozen getter
      Object.defineProperty(this, 'url', {
        enumerable: true,
        value: url
      })
    }

    static load (url) {
      var errStack = (new Error()).stack
      const a = new DPackVault(url)
      return Promise.all([a[LOAD_PROMISE], a[URL_PROMISE]])
        .then(() => a)
        .catch(e => throwWithFixedStack(e, errStack))
    }

    static create (opts = {}) {
      var errStack = (new Error()).stack
      return dWebRPC.createVault(opts)
        .then(newUrl => new DPackVault(newUrl))
        .catch(e => throwWithFixedStack(e, errStack))
    }

    static fork (url, opts = {}) {
      var errStack = (new Error()).stack
      url = (typeof url.url === 'string') ? url.url : url
      if (!isDWebURL(url)) {
        throwWithFixedStack(new Error('Invalid URL: must be a dweb:// URL'), errStack)
      }
      return dWebRPC.forkVault(url, opts)
        .then(newUrl => new DPackVault(newUrl))
        .catch(e => throwWithFixedStack(e, errStack))
    }

    static unlink (url) {
      var errStack = (new Error()).stack
      url = (typeof url.url === 'string') ? url.url : url
      if (!isDWebURL(url)) {
        throwWithFixedStack(new Error('Invalid URL: must be a dweb:// URL'), errStack)
      }
      return dWebRPC.unlinkVault(url)
        .catch(e => throwWithFixedStack(e, errStack))
    }

    // override to create the activity stream if needed
    addEventListener (type, callback) {
      if (type === 'network-changed' || type === 'download' || type === 'upload' || type === 'sync') {
        createNetworkActStream(this)
      }
      super.addEventListener(type, callback)
    }

    async getInfo (opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.getInfo(url, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async configure (info, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.configure(url, info, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    checkout (version) {
      const urlParsed = parseDWebURL(this.url)
      version = typeof version === 'number' ? `+${version}` : ''
      return new DPackVault(`dweb://${urlParsed.hostname}${version}`)
    }

    async diff (opts = {}) {
      // noop
      console.warn('The DPackVault diff() API has been deprecated.')
      return []
    }

    async commit (opts = {}) {
      // noop
      console.warn('The DPackVault commit() API has been deprecated.')
      return []
    }

    async revert (opts = {}) {
      // noop
      console.warn('The DPackVault revert() API has been deprecated.')
      return []
    }

    async history (opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.history(url, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async stat (path, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return new Stat(await dWebRPC.stat(url, path, opts))
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async readFile (path, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.readFile(url, path, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async writeFile (path, data, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.writeFile(url, path, data, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async unlink (path, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.unlink(url, path, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async copy (path, dstPath, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return dWebRPC.copy(url, path, dstPath, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async rename (path, dstPath, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return dWebRPC.rename(url, path, dstPath, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async download (path = '/', opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.download(url, path, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async readdir (path = '/', opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        var names = await dWebRPC.readdir(url, path, opts)
        if (opts.stat) {
          names.forEach(name => { name.stat = new Stat(name.stat) })
        }
        return names
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async mkdir (path, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.mkdir(url, path, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    async rmdir (path, opts = {}) {
      var errStack = (new Error()).stack
      try {
        var url = await this[URL_PROMISE]
        return await dWebRPC.rmdir(url, path, opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    createFileActivityStream (pathSpec = null) {
      console.warn('The DPackVault createFileActivityStream() API has been deprecated, use watch() instead.')
      return this.watch(pathSpec)
    }

    watch (pathSpec = null) {
      var errStack = (new Error()).stack
      try {
        return fromEventStream(dWebRPC.watch(this.url, pathSpec))
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    createNetworkActivityStream () {
      console.warn('The DPackVault createNetworkActivityStream() API has been deprecated, use addEventListener() instead.')
      var errStack = (new Error()).stack
      try {
        return fromEventStream(dWebRPC.createNetworkActivityStream(this.url))
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    static async resolveName (name) {
      var errStack = (new Error()).stack
      try {
        // simple case: DPackVault.resolveName(window.location)
        if (name === window.location) {
          name = window.location.toString()
        }
        return await dWebRPC.resolveName(name)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    static selectVault (opts = {}) {
      var errStack = (new Error()).stack
      return dWebRPC.selectVault(opts)
        .then(url => new DPackVault(url))
        .catch(e => throwWithFixedStack(e, errStack))
    }
  }

  // add internal methods
  if (window.location.protocol === 'bench:') {
    DPackVault.importFromFilesystem = async function (opts = {}) {
      var errStack = (new Error()).stack
      try {
        return await dWebRPC.importFromFilesystem(opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    DPackVault.exportToFilesystem = async function (opts = {}) {
      var errStack = (new Error()).stack
      try {
        return await dWebRPC.exportToFilesystem(opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    DPackVault.exportToVault = async function (opts = {}) {
      var errStack = (new Error()).stack
      try {
        return await dWebRPC.exportToVault(opts)
      } catch (e) {
        throwWithFixedStack(e, errStack)
      }
    }

    DPackVault.diff = async function (srcUrl, dstUrl, opts = {}) {
      if (srcUrl && typeof srcUrl.url === 'string') srcUrl = srcUrl.url
      if (dstUrl && typeof dstUrl.url === 'string') dstUrl = dstUrl.url
      var errStack = (new Error()).stack
      return dWebRPC.diff(srcUrl, dstUrl, opts)
        .catch(e => throwWithFixedStack(e, errStack))
    }

    DPackVault.merge = async function (srcUrl, dstUrl, opts = {}) {
      if (srcUrl && typeof srcUrl.url === 'string') srcUrl = srcUrl.url
      if (dstUrl && typeof dstUrl.url === 'string') dstUrl = dstUrl.url
      var errStack = (new Error()).stack
      return dWebRPC.merge(srcUrl, dstUrl, opts)
        .catch(e => throwWithFixedStack(e, errStack))
    }
  }

  // internal methods
  // =

  function setHidden (t, attr, value) {
    Object.defineProperty(t, attr, {enumerable: false, value})
  }

  function isDWebURL (url) {
    var urlp = parseDWebURL(url)
    return urlp && urlp.protocol === 'dweb:'
  }

  function throwWithFixedStack (e, errStack) {
    e = e || new Error()
    e.stack = e.stack.split('\n')[0] + '\n' + errStack.split('\n').slice(2).join('\n')
    throw e
  }

  function createNetworkActStream (vault) {
    if (vault[NETWORK_ACT_STREAM]) return
    var s = vault[NETWORK_ACT_STREAM] = fromEventStream(dWebRPC.createNetworkActivityStream(vault.url))
    s.addEventListener('network-changed', detail => vault.dispatchEvent(new Event('network-changed', {target: vault, peers: detail.connections})))
    s.addEventListener('download', detail => vault.dispatchEvent(new Event('download', {target: vault, feed: detail.feed, block: detail.block, bytes: detail.bytes})))
    s.addEventListener('upload', detail => vault.dispatchEvent(new Event('upload', {target: vault, feed: detail.feed, block: detail.block, bytes: detail.bytes})))
    s.addEventListener('sync', detail => vault.dispatchEvent(new Event('sync', {target: vault, feed: detail.feed})))
  }

  return DPackVault
}

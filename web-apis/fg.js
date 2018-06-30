const DPackVault = require('./fg/dpack-vault')
const dbrowser = require('./fg/dbrowser')
const experimental = require('./fg/experimental')

exports.setup = function ({rpcAPI}) {
  // setup APIs
  if (['bench:', 'dweb:', 'https:'].includes(window.location.protocol) ||
      (window.location.protocol === 'http:' && window.location.hostname === 'localhost')) {
    window.DPackVault = DPackVault.setup(rpcAPI)
  }
  if (['bench:', 'dweb:'].includes(window.location.protocol)) {
    window.dbrowser = dbrowser.setup(rpcAPI)
    window.experimental = experimental.setup(rpcAPI)
  }
}

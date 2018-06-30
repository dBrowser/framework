const assert = require('assert')
const {join} = require('path')
const globals = require('./globals')
const {getEnvVar} = require('./lib/env')
const dweb = require('./dweb')
const ddbs = require('./ddbs')
const webapis = require('./web-apis/bg')

module.exports = {
  getEnvVar,
  globals,
  dweb,
  ddbs,

  setup (opts) {
    assert(typeof opts.userDataPath === 'string', 'userDataPath must be a string')
    assert(typeof opts.homePath === 'string', 'homePath must be a string')
    assert(!!opts.permsAPI, 'must provide permsAPI')
    assert(!!opts.uiAPI, 'must provide uiAPI')
    assert(!!opts.rpcAPI, 'must provide rpcAPI')
    assert(!!opts.downloadsWebAPI, 'must provide downloadsWebAPI')
    assert(!!opts.browserWebAPI, 'must provide browserWebAPI')

    for (let k in opts) {
      globals[k] = opts[k]
    }

    // setup databases
    for (let k in ddbs) {
      if (ddbs[k].setup) {
        ddbs[k].setup(opts)
      }
    }

    // setup dWeb
    dweb.repository.setup({logfilePath: join(globals.userDataPath, 'dweb.log')})

    // setup web apis
    webapis.setup(opts)
  }
}

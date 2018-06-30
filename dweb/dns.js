const {InvalidDomainName} = require('@dbrowser/errors')
const sitedataDb = require('../ddbs/sitedata')
const {DWEB_HASH_REGEX} = require('../lib/const')

// instantate a dns cache and export it
const dwebDns = require('@dwebs/dns')({
  persistentCache: {read, write}
})
module.exports = dwebDns

// wrap resolveName() with a better error
const resolveName = dwebDns.resolveName
dwebDns.resolveName = function () {
  return resolveName.apply(dwebDns, arguments)
    .catch(_ => {
      throw new InvalidDomainName()
    })
}

// persistent cache methods
const sitedataDbOpts = {dontExtractOrigin: true}
async function read (name, err) {
  var key = await sitedataDb.get('dweb:' + name, 'dpack-key', sitedataDbOpts)
  if (!key) throw err
  return key
}
async function write (name, key) {
  if (DWEB_HASH_REGEX.test(name)) return // dont write for raw urls
  await sitedataDb.set('dweb:' + name, 'dpack-key', key, sitedataDbOpts)
}

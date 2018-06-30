const {getActiveVaults} = require('./repository')
const dwebDns = require('./dns')

exports.vaultsDebugPage = function () {
  var vaults = getActiveVaults()
  return `<html>
    <body>
      ${Object.keys(vaults).map(key => {
    var a = vaults[key]
    return `<div style="font-family: monospace">
          <h3>${a.key.toString('hex')}</h3>
          <table>
            <tr><td>Meta DKey</td><td>${a.revelationKey.toString('hex')}</td></tr>
            <tr><td>Content DKey</td><td>${a.content.revelationKey.toString('hex')}</td></tr>
            <tr><td>Meta Key</td><td>${a.key.toString('hex')}</td></tr>
            <tr><td>Content Key</td><td>${a.content.key.toString('hex')}</td></tr>
            ${a.replicationStreams.map((s, i) => `
              <tr><td>Peer ${i}</td><td>${s.peerInfo.type} ${s.peerInfo.host}:${s.peerInfo.port}</td></tr>
            `).join('')}
          </table>
        </div>`
  }).join('')}
    </body>
  </html>`
}

exports.dwebDnsCachePage = function () {
  var cache = dwebDns.listCache()
  return `<html>
    <body>
      <h1>dWeb DNS cache</h1>
      <p><button>Clear cache</button></p>
      <table style="font-family: monospace">
        ${Object.keys(cache).map(name => {
    var key = cache[name]
    return `<tr><td><strong>${name}</strong></td><td>${key}</td></tr>`
  }).join('')}
      </table>
      <script src="bench://dweb-dns-cache/main.js"></script>
    </body>
  </html>`
}

exports.dwebDnsCacheJS = function () {
  return `
    document.querySelector('button').addEventListener('click', clear)
    async function clear () {
      await dbrowser.vaults.clearDnsCache()
      location.reload()
    }
  `
}

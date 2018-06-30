const dwebCodec = require('@dwebs/codec')

const findFullRevelationKey = exports.findFullRevelationKey = function (vaultsByDKey, key) {
  key = Buffer.isBuffer(key) ? key.toString('hex') : key
  // HACK
  // if the key is short, try to find the full thing in our list
  // (this shouldnt be needed once revelation stops truncating keys)
  // -prf
  if (key && key.length === 40) {
    let dKeys = Object.keys(vaultsByDKey)
    for (let i = 0; i < dKeys.length; i++) {
      if (dKeys[i].startsWith(key)) {
        return dKeys[i]
      }
    }
  }
  return key
}

const getDNSMessageRevelationKey = exports.getDNSMessageRevelationKey = function (vaultsByDKey, msg) {
  var key
  function check (obj) {
    if (!key && obj.name.endsWith('.dpack.local')) {
      key = findFullRevelationKey(vaultsByDKey, obj.name.slice(0, -10))
    }
  }
  if (msg.questions) msg.questions.forEach(check)
  if (msg.answers) msg.answers.forEach(check)
  if (msg.additionals) msg.additionals.forEach(check)
  return key || ''
}

function has (str, v) {
  return str.indexOf(v) !== -1
}

const addVaultFlockLogging = exports.addVaultFlockLogging = function ({vaultsByDKey, log, vaultFlock}) {
  vaultFlock.on('listening', () => {
    vaultFlock._revelation.dns.on('traffic', (type, details) => {
      let vault = vaultsByDKey[getDNSMessageRevelationKey(vaultsByDKey, details.message)]
      if (!vault) return
      log(dwebCodec.toStr(vault.key), {
        event: 'traffic',
        trafficType: type,
        messageId: details.message.id,
        message: renderDNSTraffic(details.message),
        peer: details.peer ? `${details.peer.address || details.peer.host}:${details.peer.port}` : undefined
      })
    })
  })
  vaultFlock.on('peer', (peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'peer-found',
      peer: `${peer.address || peer.host}:${peer.port}`
    })
  })
  vaultFlock.on('peer-banned', (peer, details) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'peer-banned',
      peer: `${peer.address || peer.host}:${peer.port}`,
      message: peerBannedReason(details.reason)
    })
  })
  vaultFlock.on('peer-rejected', (peer, details) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'peer-rejected',
      peer: `${peer.address || peer.host}:${peer.port}`,
      message: peerRejectedReason(details.reason)
    })
  })
  vaultFlock.on('drop', (peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'peer-dropped',
      peer: `${peer.address || peer.host}:${peer.port}`,
      message: 'Too many failed connection attempts'
    })
  })
  vaultFlock.on('connecting', (peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'connecting',
      peer: `${peer.address || peer.host}:${peer.port}`
    })
  })
  vaultFlock.on('connect-failed', (peer, details) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'connect-failed',
      peer: `${peer.address || peer.host}:${peer.port}`,
      message: connectFailedMessage(details)
    })
  })
  vaultFlock.on('handshaking', (conn, peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'handshaking',
      peer: `${peer.address || peer.host}:${peer.port}`,
      connectionId: conn._debugId,
      connectionType: peer.type,
      ts: 0
    })
  })
  vaultFlock.on('handshake-timeout', (conn, peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'handshake-timeout',
      peer: `${peer.address || peer.host}:${peer.port}`,
      connectionId: conn._debugId,
      connectionType: peer.type,
      ts: Date.now() - conn._debugStartTime
    })
  })
  vaultFlock.on('connection', (conn, peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'connection-established',
      peer: `${peer.address || peer.host}:${peer.port}`,
      connectionId: conn._debugId,
      connectionType: peer.type,
      ts: Date.now() - conn._debugStartTime,
      message: 'Starting replication'
    })
  })
  vaultFlock.on('redundant-connection', (conn, peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'redundant-connection',
      peer: `${peer.address || peer.host}:${peer.port}`,
      connectionId: conn._debugId,
      connectionType: peer.type,
      ts: Date.now() - conn._debugStartTime
    })
  })
  vaultFlock.on('connection-closed', (conn, peer) => {
    let vault = vaultsByDKey[findFullRevelationKey(vaultsByDKey, peer.channel)]
    if (!vault) return
    log(dwebCodec.toStr(vault.key), {
      event: 'connection-closed',
      peer: `${peer.address || peer.host}:${peer.port}`,
      connectionId: conn._debugId,
      connectionType: peer.type,
      ts: Date.now() - conn._debugStartTime
    })
  })
}

const renderDNSTraffic = exports.renderDNSTraffic = function ({questions, answers, additionals}) {
  var messageParts = []
  if (questions && (!answers || !answers.length) && (!additionals || !additionals.length)) {
    questions.forEach(q => {
      if (q.type === 'TXT') {
        messageParts.push('TXT Question (requesting peers list)')
      } else {
        messageParts.push(q.type + ' Question')
      }
    })
  }
  if (answers) {
    answers.forEach(a => {
      if (a.type === 'TXT' && a.data) {
        let data = a.data.toString()
        if (has(data, 'host') && has(data, 'token')) {
          messageParts.push('TXT Answer (heres a session token)')
        } else if (has(data, 'peers')) {
          messageParts.push('TXT Answer (heres a peers list)')
        } else if (has(data, 'token')) {
          messageParts.push('TXT Answer (no peers found)')
        } else {
          messageParts.push('TXT Answer')
        }
      } else {
        messageParts.push(a.type + ' Answer')
      }
    })
  }
  if (additionals) {
    additionals.forEach(a => {
      if (a.type === 'TXT' && a.data) {
        let data = a.data.toString()
        if (has(data, 'announce')) {
          messageParts.push('TXT Additional (announcing self)')
        } else if (has(data, 'unannounce')) {
          messageParts.push('TXT Additional (unannouncing self)')
        } else if (has(data, 'subscribe')) {
          messageParts.push('TXT Additional (subscribing)')
        } else {
          messageParts.push('TXT Additional')
        }
      } else if (a.type === 'SRV' && a.data) {
        messageParts.push('SRV Additional (pushed announcement)')
      } else {
        messageParts.push(a.type + ' Additional')
      }
    })
  }
  return messageParts.join(', ')
}

function connectFailedMessage (details) {
  if (details.timedout) return 'Timed out'
}

function peerBannedReason (reason) {
  switch (reason) {
    case 'detected-self': return 'Detected that the peer is this process'
    case 'application': return 'Peer was removed by the application'
  }
  return ''
}

function peerRejectedReason (reason) {
  switch (reason) {
    case 'whitelist': return 'Peer was not on the whitelist'
    case 'banned': return 'Peer is on the ban list'
    case 'duplicate': return 'Peer was a duplicate (already being handled)'
  }
  return ''
}

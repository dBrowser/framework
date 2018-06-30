/* globals window */

const URL = typeof window === 'undefined' ? require('url').URL : window.URL

exports.getPermId = function (permissionToken) {
  return permissionToken.split(':')[0]
}

exports.getPermParam = function (permissionToken) {
  return permissionToken.split(':').slice(1).join(':')
}

exports.ucfirst = function (str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

exports.pluralize = function (num, base, suffix = 's') {
  if (num === 1) { return base }
  return base + suffix
}

exports.shorten = function (str, n = 6) {
  if (str.length > (n + 3)) {
    return str.slice(0, n) + '...'
  }
  return str
}

const shortenHash = exports.shortenHash = function (str, n = 6) {
  if (str.startsWith('dweb://')) {
    return 'dweb://' + shortenHash(str.slice('dweb://'.length).replace(/\/$/, '')) + '/'
  }
  if (str.length > (n + 5)) {
    return str.slice(0, n) + '..' + str.slice(-2)
  }
  return str
}

exports.makeSafe = function (str) {
  return str.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&/g, '&amp;').replace(/"/g, '')
}

exports.getHostname = function (str) {
  try {
    const u = new URL(str)
    if (u.protocol === 'dweb:' && u.hostname.length === 64) {
      return 'dweb://' + shortenHash(u.hostname)
    }
    return u.hostname
  } catch (e) {
    return str
  }
}

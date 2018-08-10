module.exports = {
  loadVault: 'promise',
  createVault: 'promise',
  forkVault: 'promise',
  unlinkVault: 'promise',

  getInfo: 'promise',
  configure: 'promise',
  history: 'promise',

  stat: 'promise',
  readFile: 'promise',
  writeFile: 'promise',
  unlink: 'promise',
  copy: 'promise',
  rename: 'promise',
  download: 'promise',

  readdir: 'promise',
  mkdir: 'promise',
  rmdir: 'promise',

  watch: 'readable',
  createNetworkActivityStream: 'readable',

  resolveName: 'promise',
  selectVault: 'promise',

  diff: 'promise',
  merge: 'promise',

  importFromFilesystem: 'promise',
  exportToFilesystem: 'promise',
  exportToVault: 'promise',
}

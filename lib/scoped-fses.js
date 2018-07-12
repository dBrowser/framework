const VFSystemWrapper = require('@dbrowser/vfswrapper')

// globals
// =

var scopedFSes = {} // map of scoped filesystems, kept in memory to reduce allocations

// exported APIs
// =

exports.get = function (path) {
  if (!(path in scopedFSes)) {
    scopedFSes[path] = new VFSystemWrapper(path)
  }
  return scopedFSes[path]
}

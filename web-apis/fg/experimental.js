/* globals Request Response */

const {EventTargetFromStream} = require('./event-target')
const errors = require('@dbrowser/errors')

const experimentalRepositoryManifest = require('../manifests/external/experimental/repository')
const experimentalGlobalFetchManifest = require('../manifests/external/experimental/global-fetch')

exports.setup = function (rpc) {
  const experimental = {}
  const opts = {timeout: false, errors}

  // dWeb or internal only
  if (window.location.protocol === 'bench:' || window.location.protocol === 'dweb:') {
    const repositoryRPC = rpc.importAPI('experimental-repository', experimentalRepositoryManifest, opts)
    const globalFetchRPC = rpc.importAPI('experimental-global-fetch', experimentalGlobalFetchManifest, opts)

    // experimental.repository
    let repositoryEvents = ['added', 'removed', 'updated', 'folder-synced', 'network-changed']
    experimental.repository = new EventTargetFromStream(repositoryRPC.createEventStream.bind(repositoryRPC), repositoryEvents)
    experimental.repository.add = repositoryRPC.add
    experimental.repository.remove = repositoryRPC.remove
    experimental.repository.get = repositoryRPC.get
    experimental.repository.list = repositoryRPC.list
    experimental.repository.requestAdd = repositoryRPC.requestAdd
    experimental.repository.requestRemove = repositoryRPC.requestRemove

    // experimental.globalFetch
    experimental.globalFetch = async function globalFetch (input, init) {
      var request = new Request(input, init)
      if (request.method !== 'HEAD' && request.method !== 'GET') {
        throw new Error('Only HEAD and GET requests are currently supported by globalFetch()')
      }
      var responseData = await globalFetchRPC.fetch({
        method: request.method,
        url: request.url,
        headers: request.headers
      })
      return new Response(responseData.body, responseData)
    }
  }

  return experimental
}

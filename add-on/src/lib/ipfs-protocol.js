const { mimeSniff } = require('./mime-sniff')
const dirView = require('./dir-view')
const PathUtils = require('ipfs/src/http/gateway/utils/path')
const toStream = require('into-stream')

function formatResponse ({mimeType, data, charset}) {
  if (!data.pipe) {
    // console.log('TO STREAM', data)
    data = toStream(data)
  }
  // TODO: add charset for text reponses.
  const res = {
    statusCode: 200,
    headers: {
      'Content-Type': mimeType
    },
    data: data
  }
  // console.log('IPFS RES', res)
  return res
}

exports.createIpfsUrlProtocolHandler = (getIpfs) => {
  return async (request, reply) => {
    console.time('[ipfs-companion] IpfsUrlProtocolHandler')
    console.log(`[ipfs-companion] handling ${request.url}`)

    let path = request.url.replace('ipfs://', '/')
    path = path.startsWith('/ipfs') ? path : `/ipfs${path}`

    const ipfs = getIpfs()

    try {
      const {data, mimeType, charset} = await getDataAndGuessMimeType(ipfs, path)
      console.log(`[ipfs-companion] returning ${path} as mime ${mimeType} and charset ${charset}`)
      reply(formatResponse({mimeType, data, charset}))
    } catch (err) {
      console.error('[ipfs-companion] failed to get data', err)
      reply(formatResponse({mimeType: 'text/html', data: `Error ${err.message}`}))
    }

    console.timeEnd('[ipfs-companion] IpfsUrlProtocolHandler')
  }
}

async function getDataAndGuessMimeType (ipfs, path) {
  try {
    const buffer = await ipfs.files.cat(path)
    const mimeType = mimeSniff(buffer, path) || 'text/plain'
    return {mimeType, data: buffer}
  } catch (err) {
    if (err.message.toLowerCase() === 'this dag node is a directory') {
      return getDirectoryListingOrIndexData(ipfs, path)
    }
    throw err
  }
}

async function getDirectoryListingOrIndexData (ipfs, path) {
  const listing = await ipfs.ls(path)
  const index = listing.find((l) => ['index', 'index.html', 'index.htm'].includes(l.name))

  if (index) {
    return getDataAndGuessMimeType(ipfs, PathUtils.joinURLParts(path, index.name))
  }

  return {
    mimeType: 'text/html',
    data: dirView.render(path.replace(/^\/ipfs\//, 'ipfs://'), listing),
    charset: 'utf8'
  }
}

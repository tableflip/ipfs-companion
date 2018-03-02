const { mimeSniff } = require('./mime-sniff')
const peek = require('buffer-peek-stream')
const dirView = require('./dir-view')
const PathUtils = require('ipfs/src/http/gateway/utils/path')
const toStream = require('into-stream')

exports.createIpfsUrlProtocolHandler = (getIpfs) => {
  return async (request, reply) => {
    console.time('[ipfs-companion] IpfsUrlProtocolHandler')
    console.log(`[ipfs-companion] handling ${request.url}`)

    let path = request.url.replace('ipfs://', '/')
    path = path.startsWith('/ipfs') ? path : `/ipfs${path}`

    let res

    try {
      res = await getResponse(getIpfs(), path)
    } catch (err) {
      console.error(`[ipfs-companion] failed handle ${request.url}`, err)

      res = {
        statusCode: 500,
        headers: { 'content-type': 'text/plain' },
        data: toStream(err.message)
      }
    }

    console.log(`[ipfs-companion] ${request.url} => ${res.statusCode}`, res.headers)
    reply(res)
    console.timeEnd('[ipfs-companion] IpfsUrlProtocolHandler')
  }
}

async function getResponse (ipfs, path) {
  let listing

  try {
    listing = await ipfs.ls(path)
  } catch (err) {
    if (err.message === 'file does not exist') {
      return {
        statusCode: 404,
        headers: { 'content-type': 'text/plain' },
        data: toStream('Not found')
      }
    }

    throw err
  }

  if (isDirectory(listing)) {
    return getDirectoryListingOrIndexResponse(ipfs, path, listing)
  }

  const { stream, contentType } = await new Promise((resolve, reject) => {
    peek(ipfs.files.catReadableStream(path), 512, (err, data, stream) => {
      if (err) return reject(err)
      const contentType = mimeSniff(data, path) || 'text/plain'
      resolve({ stream, contentType })
    })
  })

  return {
    statusCode: 200,
    headers: { 'content-type': contentType },
    data: stream
  }
}

function isDirectory (listing) {
  if (!listing.length) return false
  if (listing.length === 1) return true

  // If every path in the listing is the same, IPFS has listed blocks for a file
  // if not then it is a directory listing.
  const path = listing[0].path
  return !listing.every(f => f.path === path)
}

function getDirectoryListingOrIndexResponse (ipfs, path, listing) {
  const indexFileNames = ['index', 'index.html', 'index.htm']
  const index = listing.find((l) => indexFileNames.includes(l.name))

  if (index) {
    let contentType = 'text/plain'

    if (index.name.endsWith('.html') || index.name.endsWith('.htm')) {
      contentType = 'text/html'
    }

    return {
      statusCode: 200,
      headers: { 'content-type': contentType },
      data: ipfs.files.catReadableStream(PathUtils.joinURLParts(path, index.name))
    }
  }

  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    data: toStream(dirView.render(path.replace(/^\/ipfs\//, 'ipfs://'), listing))
  }
}

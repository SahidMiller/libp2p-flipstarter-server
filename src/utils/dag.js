const importer = require('ipfs-unixfs-importer')
const IPLD = require('ipld')
const inMemory = require('ipld-in-memory')
const { DAGNode } = require('ipld-dag-pb')
const UnixFS = require('ipfs-unixfs')
const multicodec = require('multicodec')

const toDagNodeFile = (data) => {
	const file = new UnixFS({ type: 'file', data }).marshal();
	return new DAGNode(file);
}

const toDagNodeDirectory = (links) => {
	const dir = new UnixFS({ type: 'directory' }).marshal();
	return new DAGNode(dir, links)
}

const hashData = async (content, options) => {
  options = options || {}
  options.onlyHash = true

  const ipld = await inMemory(IPLD)
  let lastResult

  for await (const result of importer([{ content }], ipld, options)) {
    lastResult = result
  }

  return {
    cid: `${lastResult.cid}`,
    size: lastResult.size
  }
}

const hashNode = async (node, options) => {
	const ipld = await inMemory(IPLD)
	const { format, cidVersion, hashAlg } = options

	const formatName = format.toUpperCase().replace(/-/g, '_');
	const formatCodec = multicodec[formatName]

	const hashAlgName = hashAlg.toUpperCase().replace(/-/g, '_');
	const hashAlgCodec = multicodec[hashAlgName]
	return ipld.put(node, formatCodec, {
		hashAlg: hashAlgCodec,
		cidVersion: 0,
		onlyHash: true
	})
}

module.exports = { toDagNodeDirectory, toDagNodeFile, hashData, hashNode }
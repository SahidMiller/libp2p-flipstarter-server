const { collect } = require('streaming-iterables')
const { toDagNodeFile, toDagNodeDirectory } = require('./dag')
const CID = require('cids')

async function cat(ipfs, path) {
	const [data] = (await collect(ipfs.cat(path)))
	return data
}

async function genKey(ipfs, keyName) {
	const keys = await ipfs.key.list()
	const foundKey = keys.find(key => key.name === keyName)
	return foundKey || await ipfs.key.gen(keyName)
}

async function uploadFile(ipfs, name, data) {
	const encoded = new TextEncoder().encode(data)
	const file = toDagNodeFile(encoded)
	const info = await ipfs.dag.put(file, { format: 'dag-pb', hashAlg: 'sha2-256' })
	const hash = new CID(info.multihash).toBaseEncodedString()
	return { Hash: hash, Tsize: file.size, Name: name }
}

async function uploadDirectory(ipfs, name, links) {
	const directory = toDagNodeDirectory(links)
	const info = await ipfs.dag.put(directory, { format: 'dag-pb', hashAlg: 'sha2-256' })
	const hash = new CID(info.multihash).toBaseEncodedString()
	return { Hash: hash, Tsize: directory.size, Name: name }
}

module.exports = { cat, genKey, uploadFile, uploadDirectory }
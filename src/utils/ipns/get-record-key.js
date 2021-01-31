const ipns = require('ipns')
const uint8ArrayToString = require('uint8arrays/to-string')
const CID = require('cids')

module.exports = (id) => {
  const origMh = new CID(id).multihash
  const base58mh = new CID(1, 'libp2p-key', origMh, "base58btc").multihash
  const key = ipns.getIdKeys(base58mh).routingKey.uint8Array();
  const serialized = uint8ArrayToString(key, 'base64url');
  return "/record/" + serialized;
}


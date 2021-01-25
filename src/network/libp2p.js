const Libp2p = require('libp2p');
const TCP = require('libp2p-tcp')
const { NOISE } = require('libp2p-noise')
const MPLEX = require('libp2p-mplex')
const GossipSub = require('libp2p-gossipsub')
const WS = require('libp2p-websockets')
const Bootstrap = require('libp2p-bootstrap')
const crypto = require('libp2p-crypto')

const CID = require('cids')
const PeerId = require('peer-id')
const uint8ArrayFromString = require('uint8Arrays/from-string')

module.exports = async function() {
  
  //Setup keys for libp2p node can be reached and secured by some private key
  const privateKey = await crypto.keys.import(__RSA_KEY__, __RSA_PASSWORD__)
  const publicKeyHash = await privateKey.public.hash()
  const publishingId = new CID(1, 'libp2p-key', publicKeyHash, 'base36').toBaseEncodedString()
  const peerIdString = new CID(publicKeyHash).toBaseEncodedString()

  const libp2p = await Libp2p.create({
    modules: {
      transport: [TCP, WS],
      connEncryption: [NOISE],
      streamMuxer: [MPLEX],
      pubsub: GossipSub,
      peerDiscovery: [Bootstrap]
    },
    config: {
      peerDiscovery: {
        autoDial: true,
        [Bootstrap.tag]: {
          enabled: true,
          list: [
            '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmZa1sAxajnQjVM8WjWXoMbmPd7NsWhfKsPkErzpm9wGkp',
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
            '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
            '/dns4/node0.preload.ipfs.io/tcp/443/wss/p2p/QmZMxNdpMkewiVZLMRxaNxUeZpDUb34pWjZ1kZvsd16Zic',
            '/dns4/node1.preload.ipfs.io/tcp/443/wss/p2p/Qmbut9Ywz9YEDrz8ySBSgWyJk41Uvm2QJPhwDJzJyGFsD6',
            '/dns4/node2.preload.ipfs.io/tcp/443/wss/p2p/QmV7gnbW5VTcJ3oyM2Xk1rdFBJ3kTkvxc87UFGsun29STS',
            '/dns4/node3.preload.ipfs.io/tcp/443/wss/p2p/QmY7JB6MQXhxHvq7dBDh4HpbH29v4yE9JRadAVpndvzySN'
          ]
        }
      }
    },
    addresses: {
      listen: [
        //Public swarm addresses are shared with create endpoint
        ...(__PUBLIC_SWARM_ADDRESSES__),
        //Private swarm addresses are not shared with create endpoint
        ...(__PRIVATE_SWARM_ADDRESSES__)
      ]
    },
    peerId: new PeerId(
      uint8ArrayFromString(peerIdString, 'base58btc'), 
      privateKey
    )
  })

  await libp2p.start()

  try {
    
    await libp2p.dial(__REMOTE_MULTI_ADDRESS__)
  
  } catch {

    throw "Failed to connect to remote libp2p address"
  }

  return libp2p
}
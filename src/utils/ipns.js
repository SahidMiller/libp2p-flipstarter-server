const ipns = require('ipns')
const IpfsHttpClient = require('ipfs-http-client')
const last = require('it-last')
const multihash = require('multihashes')
const uint8ArrayToString = require('uint8arrays/to-string')
const pRetry = require('p-retry')
const CID = require('cids')
const http = require('http')
const https = require('https')
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 6
})
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 6
})

const crypto = require('libp2p-crypto')

const preloadNodes = [
  "http://node0.preload.ipfs.io", 
  "http://node1.preload.ipfs.io", 
  "http://node2.preload.ipfs.io", 
  "http://node3.preload.ipfs.io"
]

const unmarshalIpnsMessage = (message) => {
	return ipns.unmarshal(message.data)
}

function getSerializedRecordKey(id) {
  const origMh = new CID(id).multihash
  const base58mh = new CID(1, 'libp2p-key', origMh, "base58btc").multihash
  const key = ipns.getIdKeys(base58mh).routingKey.uint8Array();
  const serialized = uint8ArrayToString(key, 'base64url');
  return "/record/" + serialized;
}

async function resolveIPNSKey(ipfs, key, options = {}) {
  return await last(ipfs.name.resolve(key, { stream: false, ...options }));
}

async function startRemoteListeners(id) {
  const startRemoteListeners = async () => {
    try {

      return await resolveIPNSKey(IpfsHttpClient({ 
        url: endpoint,
        agent: function (parsedURL) {
              // return an agent that allows redirection from http to https
              if (parsedURL.protocol === 'http:') {
                return httpAgent
              } else {
                return httpsAgent
            }
        }
      }), id)

    } catch(err) {

    }
  }

	return await Promise.all(preloadNodes.map(endpoint => {
    startRemoteListeners()
    return new Promise((resolve) => setTimeout(resolve, 1000))
  }))
}

async function waitForPeers(ipfs, topic, checkPeers) {

  return await pRetry((attemptNumber) => {

    return new Promise(async (resolve, reject) => {

      const peers = await ipfs.pubsub.peers(topic)
      
      if (await checkPeers(peers)) {
        
        resolve(peers)
      
      } else {

        const error = new Error("no peers")
        reject(error)
      }
    })
  }, { 
    minTimeout: 5000, 
    retry: 10 
  })
}

async function updateIPNS(ipfs, libp2p, privateKey, keyId, seqNum = 0, cid) {
  
  startRemoteListeners(keyId)

  //Make sure remote is subscribed (are they automatically since they generated key?)
  resolveIPNSKey(ipfs, keyId)
  
  const recordKey = getSerializedRecordKey(keyId);

  await libp2p.pubsub.subscribe(recordKey)

  //Wait for remote IPFS subs to contain our localId
  const localId = libp2p.peerId.toB58String()
  await waitForPeers(ipfs, recordKey, (peers) => {
    return !!peers.find(peer => peer === localId)
  })

  const hourMs = 60 * 60 * 1000
  const record = await ipns.create(privateKey, cid, seqNum, hourMs);
  const recordData = ipns.marshal(record);
  
  console.log("BismAllah, publishing:" + cid)
  
  //If we're connected via pubsub with our gateway and the gateway has the key 
  //    then publishing via pubsub should hook into their own republisher, God willing.
  await libp2p.pubsub.publish(recordKey, recordData);
}

module.exports = { 
  startRemoteListeners,
  resolveIPNSKey,
  updateIPNS,
  unmarshalIpnsMessage,
  getSerializedRecordKey 
}
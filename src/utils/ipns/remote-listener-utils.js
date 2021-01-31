const IpfsHttpClient = require('ipfs-http-client')
const pRetry = require('p-retry')
const resolveIpns = require('./resolve-ipns-key')

async function startRemoteListener(ipfs, id) {
  try {

    return await resolveIpns(ipfs, id);

  } catch(err) {

  }
}

async function startRemoteListeners(preloadNodes, id) {

  return await Promise.all(preloadNodes.map(endpoint => {
    startRemoteListener(IpfsHttpClient(endpoint), id)
    return new Promise((resolve) => setTimeout(resolve, 1000))
  }))
}

async function waitForRemoteListeners(ipfs, topic, checkPeers) {

  return await pRetry((attemptNumber) => {

    return new Promise(async (resolve, reject) => {

      const peers = await ipfs.pubsub.peers(topic)
      if (await checkPeers(attemptNumber, peers)) {
        
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

module.exports = {
  startRemoteListener,
  startRemoteListeners,
  waitForRemoteListeners
}
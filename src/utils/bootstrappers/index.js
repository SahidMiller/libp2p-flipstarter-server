const StreamHandler = require('./stream-handler')
const pTimeout = require('p-timeout')

module.exports = async function getRelayBootstrappers(libp2p, peers) {
	peers = peers || []
	const timeout = 10000
	const checkCanRelayHop = async (peer) => {
		const { stream } = await libp2p.dialProtocol(peer, '/libp2p/circuit/relay/0.1.0')
		const streamHandler = new StreamHandler({ stream })
		streamHandler.write({ type: 4 })
      	return (await streamHandler.read()).code === 100
    }

   	const peersCanHop = await Promise.all(peers.map(async (peer) => {
   		try {
   			
   			return { peer, canHop: await pTimeout(checkCanRelayHop(peer), timeout)  }

		} catch (err) {

			try {
				
				await libp2p.hangUp(peer)
				await pTimeout(libp2p.dial(peer), timeout)
				return { peer, canHop: await pTimeout(checkCanRelayHop(peer), timeout)   }

			} catch (err) {
				
				return { peer, canHop: false }
			}
		}
	}))

	return peersCanHop
		.filter(({ canHop }) => canHop)
		.map(({ peer }) => peer.toString())
}

const getArgv = require('./utils/get-argv')

const setup = async function(configFile = "./server-config.json") {
	require('../setup-env')(configFile)

	const createElectrumCash = require('./network/electrum')
	const createIpfs = require('./network/ipfs')
	const createLibp2p = require('./network/libp2p')
	const FlipstarterServer = require('./index')

	//Start electrum, campaign manager, repository, and flipstarter ipfs server.
	let ipfs

	try {
		
		ipfs = await createIpfs()

	} catch {
		
		throw "Failed to connect to remote gateway address"
	}

	const electrum = await createElectrumCash()
	const libp2p = await createLibp2p()

	//To conform with browser API, God willing.
	ipfs.libp2p = libp2p

	const server = new FlipstarterServer(ipfs, electrum, {
		useRelayBootstrappers: __USE_BOOTSTRAPPER_RELAY_ADDRESSES__,
		addresses: __PUBLIC_SWARM_ADDRESSES__,
		preloadNodes: __PRELOAD_NODES__
	})

	await server.start()
}

let configFile

if (!getArgv.has("config")) {
	console.log("No --config argument. Using default ./server-config.json")
} else {
	configFile = getArgv.get("config")
}

setup(configFile)
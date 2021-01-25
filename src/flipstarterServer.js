const FlipstarterIpfsRepository = require('./FlipstarterIpfsRepository')
const FlipstarterCampaignService = require('./FlipstarterCampaignService')
const createElectrumCash = require('./network/electrum')
const createIpfs = require('./network/ipfs')
const createLibp2p = require('./network/libp2p')

const { FlipstarterCommitmentWatcher } = require('flipstarter-campaign-utilities')
const { responseStream } = require('libp2p-stream-helper')
const getRelayBootstrappers = require('./utils/bootstrappers')
const { startRemoteListeners } = require('./utils/ipns')
const { uploadFile } = require('./utils/ipfs')

module.exports = async () => {

	//Start electrum, campaign manager, repository, and flipstarter ipfs server.
	let ipfs
	try {
		
		ipfs = await createIpfs()

	} catch {
		
		throw "Failed to connect to remote gateway address"
	}

	const electrum = await createElectrumCash()
	const libp2p = await createLibp2p()

	const repository = new FlipstarterIpfsRepository(ipfs, libp2p)
	const watcher = new FlipstarterCommitmentWatcher(electrum)
	const campaignService = new FlipstarterCampaignService(repository)

	const ipfsId = libp2p.peerId.toB58String()
	
	libp2p.handle('/flipstarter/create', responseStream(async (req) => {
		const publishingId = await campaignService.handleCampaignCreation(req.body.campaign)
		const addresses = await getServerAddress(libp2p)

		const campaignJSON = JSON.stringify({ ...req.body.campaign, ipfsId, publishingId, addresses })
		await uploadFile(ipfs, "campaign.json", campaignJSON)

	    return { ipfsId, publishingId, addresses }
	}))

	libp2p.handle('/flipstarter/submit', responseStream(async (req) => {
		
		const contribution = await campaignService.handleContribution(req.body.campaignId, req.body.contribution.data, req.body.contribution.inputs, async (recipients, committedSatoshis, commitmentCount, commitmentData) => {
		 	return await watcher.validateCommitment(recipients, committedSatoshis, commitmentCount, commitmentData)
		}, async (recipients, commitments) => {
	  	  	return await watcher.fullfillCampaign(recipients, commitments)
		})

	    watcher.subscribeToCommitments(contribution.commitments)

	    return { ok: true }
	}))

	//Handle submits and create 
	watcher.on('commitment-revoked', campaignService.handleRevocation.bind(campaignService))

	campaignService.checkAllCampaignCommitments(async (unverifiedCommitments) => {
	  // Notify user that the service is ready for incoming connections.
	  console.log(`Verifying a total of '${Object.keys(unverifiedCommitments).length}' existing contributions.`)
	  await watcher.checkAllCommitmentsForUpdates(unverifiedCommitments)
	})

	console.log("PeerId: " + ipfsId)
	console.log("Listening: ")
	console.log(libp2p.addresses.listen)

	updateBootstrappersRoutine(libp2p).then(relays => {
		console.log("Relays: \n")
		console.log(relays)
	})

	return ipfsId
}

async function updateBootstrappersRoutine(libp2p) {
    const bootstrappers = getBootstrappers(libp2p)

	const updateBootstrappersRoutine = async () => {
		console.log("Updating bootstrappers")
		return await getRelayBootstrappers(libp2p, bootstrappers)
	}

	setInterval(updateBootstrappersRoutine, 10 * 60 * 1000)
	return await updateBootstrappersRoutine()
}

function republishRoutine() {
	const republishRoutine = async () => {
		console.log("Updating IPNS entries")
		await startRemoteListeners()
		await repository.updateCampaigns()
	}

	republishRoutine()
	setInterval(republishRoutine, 60 * 60 * 1000)
}

function getBootstrappers(libp2p) {
	return libp2p._config.peerDiscovery.bootstrap.list
}

async function getServerAddress(libp2p) {
    const bootstrappers = getBootstrappers(libp2p)
	const ipfsId = libp2p.peerId.toB58String()

    //TODO God willing, share an IPNS address where we push our multiaddresses (like a peer-discovery mechanism)
    // campaign owner can then embed this IPNS address in campaign.json so clients can fetch/listen for address changes. 
    let addresses = []

    if (__USE_BOOTSTRAPPER_RELAY_ADDRESSES__) {
      
      const circuitRelays = await getRelayBootstrappers(libp2p, bootstrappers)
      addresses = addresses.concat(circuitRelays.map(relayAddr => relayAddr + "/p2p-circuit/p2p/" + ipfsId))
    }

    if (__PUBLIC_SWARM_ADDRESSES__) {
      addresses = addresses.concat(__PUBLIC_SWARM_ADDRESSES__)
    }

    return addresses
}
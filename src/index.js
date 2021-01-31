const FlipstarterIpfsRepository = require('./repository')
const FlipstarterCampaignService = require('./FlipstarterCampaignService')

const { FlipstarterCommitmentWatcher } = require('flipstarter-campaign-utilities')
const { responseStream } = require('libp2p-stream-helper')
const getRelayBootstrappers = require('./utils/bootstrappers')
const { startRemoteListeners } = require('./utils/ipns/remote-listener-utils')
const { uploadFile } = require('./utils/ipfs')

const EventEmitter = require('events')
const tenMinutes = 10 * 60 * 1000
const oneHour = 60 * 60 * 1000

module.exports = class FlipstarterServer extends EventEmitter {

	constructor(ipfs, electrum, opts) {
		super()
		this.opts = opts
		this.ipfs = ipfs
		this.libp2p = ipfs.libp2p
		this.repository = new FlipstarterIpfsRepository(ipfs, opts.preloadNodes || [])
		this.watcher = new FlipstarterCommitmentWatcher(electrum)
		this.campaignService = new FlipstarterCampaignService(this.repository)
	}

	async tryEmit(name, payload) {
		try {
			this.emit(name, payload)
		} catch (err) {
			console.log("emit failed", name, payload)
		}
	}

	async start() {
		const self = this
		const ipfsId = this.libp2p.peerId.toB58String()

		this.libp2p.handle('/flipstarter/create', responseStream(async (req) => {
			const campaign = await self.campaignService.handleCampaignCreation(req.body.campaign)
			const addresses = await self.getServerAddress()
			const publishingId = campaign.id

			const campaignData = { 
				...campaign, 
				apiType: "ipfs",
				ipfsId, 
				addresses,
				publishingId
			}

			delete campaignData.id
			await uploadFile(self.ipfs, "campaign.json", JSON.stringify(campaignData))
			
			self.tryEmit("campaign-updated", campaign)

		    return { ipfsId, publishingId, addresses }
		}))

		this.libp2p.handle('/flipstarter/submit', responseStream(async (req) => {
			
			const { campaign, contribution } = await self.campaignService.handleContribution(req.body.campaignId, req.body.contribution.data, req.body.contribution.inputs, async (recipients, committedSatoshis, commitmentCount, commitmentData) => {
			 	return await self.watcher.validateCommitment(recipients, committedSatoshis, commitmentCount, commitmentData)
			}, async (recipients, commitments) => {
		  	  	return await self.watcher.fullfillCampaign(recipients, commitments)
			})

		    self.watcher.subscribeToCommitments(contribution.commitments)

		    self.tryEmit("campaign-updated", campaign)

		    return { ok: true }
		}))

		this.libp2p.handle('/flipstarter/campaignDetails', responseStream(async (req) => {
			const campaignId = req.body.campaignId
			return await self.campaignService.getCampaign(campaignId)
		}))

		//Handle submits and create 
		this.watcher.on('commitment-revoked', async (commitment) => {
			const updatedCampaign = await self.campaignService.handleRevocation(commitment)
			if (updatedCampaign) {
				self.tryEmit("campaign-updated", updatedCampaign)
			}
		})


	    const campaigns = await this.repository.getCampaigns()

	    await Promise.all(campaigns.map(async (campaign) => {
	      // Check each contributions commitment..
	      const unverifiedCommitments = await FlipstarterCampaignService.getUnrevokedCommitments(campaign)

	      self.tryEmit("campaign-updated", campaign)

		  console.log(`Verifying a total of '${Object.keys(unverifiedCommitments).length}' existing contributions.`)
		  await self.watcher.checkAllCommitmentsForUpdates(unverifiedCommitments)
	    }))

		console.log("PeerId: " + ipfsId)
		console.log("Listening: ")
		console.log(this.libp2p.addresses.listen)

		const relays = await this.startUpdateBootstrappersRoutine()
		
		this.startRepublishRoutine()

		console.log("Relays: \n")
		console.log(relays)

		return { campaigns, relays }
	}

	async startUpdateBootstrappersRoutine() {
		const self = this
	    const bootstrappers = getBootstrappers(this.libp2p)

		const updateBootstrappersRoutine = async () => {
			console.log("Updating bootstrappers")
			const relays = await getRelayBootstrappers(self.libp2p, bootstrappers)
			self.tryEmit("relays-updated", relays)
			return relays
		}

		setInterval(updateBootstrappersRoutine, this.opts.updateBootstrappersInterval || tenMinutes)
		return await updateBootstrappersRoutine()
	}

	async startRepublishRoutine() {
		const self = this
		const republishRoutine = async () => {
			console.log("Updating IPNS entries")
			await startRemoteListeners(self.opts.preloadNodes)
			await self.repository.updateCampaigns()
			self.tryEmit("ipns-updated")
		}

		republishRoutine()
		setInterval(republishRoutine, this.opts.republishCampaignsInterval || oneHour)
	}
	
	async getServerAddress() {
		const ipfsId = this.libp2p.peerId.toB58String()

	    //TODO God willing, share an IPNS address where we push our multiaddresses (like a peer-discovery mechanism)
	    // campaign owner can then embed this IPNS address in campaign.json so clients can fetch/listen for address changes. 
	    let addresses = []

	    if (this.opts.useRelayBootstrappers) {
	      const bootstrappers = getBootstrappers(this.libp2p)
	      const circuitRelays = await getRelayBootstrappers(this.libp2p, bootstrappers)
	      addresses = addresses.concat(circuitRelays.map(relayAddr => relayAddr + "/p2p-circuit/p2p/" + ipfsId))
	    }

	    if (this.opts.addresses && this.opts.addresses.length) {
	      addresses = addresses.concat(this.opts.addresses)
	    }

	    return addresses
	}
}


module.exports.defaultUpdateBootstrappersInterval = tenMinutes
module.exports.defaultRepublishCampaignsInterval = oneHour

function getBootstrappers(libp2p) {
	return libp2p._config.peerDiscovery.bootstrap.list
}
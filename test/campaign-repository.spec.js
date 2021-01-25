/**
 * Admin dashboard tests
 * 
 * @group campaign-repository
 */
 describe('Campaign Repository', () => {
	jest.mock('../src/utils/ipns')
	jest.mock('libp2p-crypto', () => {
		return {
			keys: {
				import: jest.fn()
			}
		}
	})
	const Repository = require('../src/FlipstarterIpfsRepository')
	const moment = require('moment')

 	let campaignId = "fake"

 	let recipients = [{
 		address: "bchtest:qqekcwxmfzhgn775r6t382g08mx4cxclfsd2d2v0x0",
		satoshis: 558
	}]

 	let campaign = {
 		id: campaignId,
		fullfilled: false,
		starts: moment().unix(),
		expires: moment().add(1, 'days').unix(),
		recipients
	}
	
 	it('should succeed in updating campaign', async () => {
 		const cryptoMock = require('libp2p-crypto')

 		const ipfs = {
 			config: {
 				get: jest.fn(),
 				set: jest.fn()
 			},
 			dag: {
 				put: jest.fn()
 			}
 		}

 		const contributions = []
 		const fullfillmentInfo = { fullfilled: false, fullfillmentTx: null, fullfillmentTimestamp: null }
 		const expectedCid = "Qmdot27PdHdEzgtTDJsZyBbYCyPjesJ3C7tNBvrGEAqA9j"

 		const fakeContributionsFile = new TextEncoder().encode(JSON.stringify(contributions))
 		const fakeFullfillmentFile = new TextEncoder().encode(JSON.stringify(fullfillmentInfo))

 		ipfs.config.get.mockImplementation((keyName) => { 
 			if (keyName === "campaigns") {
 				return {
 					[campaignId]: {
		 				campaign,
		 				campaignCid: "oldCid",
		 				seqNum: 0
		 			}
		 		}
		 	}

		 	if (keyName === "keys") {
 				return {
 					[campaignId]: "fakePem"
		 		}
		 	}
 		})
 		
 		cryptoMock.keys.import.mockResolvedValue("fakePrivateKey")

 		let called = 0
 		ipfs.dag.put.mockImplementation(async () => {
 			switch(called) {
 				case 0:
 					called++
 					return { multihash: "QmVkvoPGi9jvvuxsHDVJDgzPEzagBaWSZRYoRDzU244HjZ" }
	 			case 1:
	 				called++
	 				return { multihash: "QmTUYxR8kQ4usDEf4vALF6jnyi2y4VfqRpbKjD4CUN2pKZ" }
	 			case 2: 
	 				called++
	 				return { multihash: "Qmdot27PdHdEzgtTDJsZyBbYCyPjesJ3C7tNBvrGEAqA9j" }
	 		}
 		})

 		const repository = new Repository(ipfs)

 		try {
 			
 			const actual = await repository.updateCampaign(campaign)
 			expect(cryptoMock.keys.import).toHaveBeenCalledTimes(1)
 			expect(cryptoMock.keys.import).toHaveBeenNthCalledWith(1, "fakePem", "temppassword")

 			expect(ipfs.dag.put).toHaveBeenCalledTimes(3)
 			expect(ipfs.config.set).toHaveBeenCalledTimes(1)
 			expect(ipfs.config.set).toHaveBeenNthCalledWith(1, "campaigns", {
 				[campaignId]: {
 					campaign,
 					campaignCid: expectedCid,
 					seqNum: 1
 				}
 			})

 			expect(actual).toEqual({
 				id: campaignId,
 				...campaign,
 				contributions,
 				...fullfillmentInfo
 			})

 		} catch (error) {
 			fail(error)
 		}
 	})

 	it('should suceed in getting an existing campaign', async () => {
 		const ipfs = {
 			config: {
 				get: jest.fn()
 			},
 			cat: jest.fn(),

 		}

 		const contributions = []
 		const fullfillmentInfo = { fullfilled: false, fullfillmentTx: null, fullfillmentTimestamp: null }
 		const expectedCid = "fake"

 		const fakeContributionsFile = new TextEncoder().encode(JSON.stringify(contributions), "utf8")
 		const fakeFullfillmentFile = new TextEncoder().encode(JSON.stringify(fullfillmentInfo))
 		ipfs.config.get.mockResolvedValue({ 
 			[campaignId]: {
 				campaign,
 				campaignCid: expectedCid
 			}
 		})
 		
 		let called = 0
 		ipfs.cat.mockImplementation(async function* () {
 			switch(called) {
 				case 0:
 					called++
 					yield fakeContributionsFile
 					break
	 			case 1:
	 				called++
	 				yield fakeFullfillmentFile
	 				break
	 		}
 		})

 		const repository = new Repository(ipfs)

 		try {
 			
 			const actual = await repository.getCampaign(campaignId)
 			expect(ipfs.cat).toHaveBeenCalledTimes(2)
 			expect(ipfs.cat).toHaveBeenNthCalledWith(1, expectedCid + "/contributions.json")
 			expect(ipfs.cat).toHaveBeenNthCalledWith(2, expectedCid + "/fullfillment.json")
 			expect(actual).toEqual({
 				id: campaignId,
 				...campaign,
 				contributions,
 				...fullfillmentInfo
 			})

 		} catch (error) {

 			fail(error)
 		}
 	})
 })
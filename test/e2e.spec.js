/**
 * Admin dashboard tests
 * 
 * @group e2e
 */
 describe('e2e', () => {
 	jest.setTimeout(30000)
	const { resolveIPNSKey, unmarshalIpnsMessage, getSerializedRecordKey } = require('../src/utils/ipns')

 	require('../setup-env')("test-config.json")

	const startServer = require('../src/flipstarterServer')
	const { cat } = require('../src/utils/ipfs')

	const moment = require('moment')
	const MockDate = require('mockdate')
	const { requestStream } = require('libp2p-stream-helper')

	let ipfsId
	let libp2p
	let removeCampaigns = []
	let ipfs
	beforeAll(async () => {

		const Libp2p = require('libp2p');
		const TCP = require('libp2p-tcp')
		const { NOISE } = require('libp2p-noise')
		const MPLEX = require('libp2p-mplex')
		const WS = require('libp2p-websockets')
		const GossipSub = require('libp2p-gossipsub')

		try {
			
			libp2p = await Libp2p.create({
			  modules: {
			    transport: [TCP, WS],
			    connEncryption: [NOISE],
			    streamMuxer: [MPLEX],
      			pubsub: GossipSub
			  }
			})
	 		
	 		await libp2p.start()
	 		await libp2p.dial(__REMOTE_MULTI_ADDRESS__)

	 		ipfs = await require('../src/network/ipfs')()

	 		ipfsId = await startServer()

	 	} catch (err) {
	 		console.log("Test failed")
	 		console.log(err)
	 	}
	})

 	it('should succeed in updating campaign ', async () => {

 		let recordKey
        const expectedTimestamp = moment()

        MockDate.set(expectedTimestamp.valueOf())

 		try {

 			const createConn = await libp2p.dialProtocol("/ip4/0.0.0.0/tcp/4465/p2p/" + ipfsId, "/flipstarter/create")
 			const campaign = {
 				starts: moment().unix(),
	 			expires: moment().add(1, 'days').unix(),
	 			recipients: [{
			 		address: "bchtest:qqekcwxmfzhgn775r6t382g08mx4cxclfsd2d2v0x0",
					satoshis: 558
				}]
 			}

 			const expectedCreateResponse = {
 				addresses: expect.anything(),
 				publishingId: expect.anything(),
 				ipfsId
 			}

 			const actualCreateResponse = await requestStream(createConn, { campaign })
 			expect(actualCreateResponse).toEqual(expectedCreateResponse)

 			removeCampaigns.push(actualCreateResponse.publishingId)

 			{
	 			const result = await resolveIPNSKey(ipfs, actualCreateResponse.publishingId)

			    let cid = result.toString().replace('/ipfs/', '')
				console.log(cid)

	 			const contributionsJson = await cat(ipfs, cid + "/contributions.json")
		        const fullfillmentJson = await cat(ipfs, cid + "/fullfillment.json")
			      
		        const contributions = JSON.parse(new TextDecoder().decode(contributionsJson))
		        const { fullfilled, fullfillmentTx, fullfillmentTimestamp } = JSON.parse(new TextDecoder().decode(fullfillmentJson))
		  	
		  		expect(contributions).toEqual([])
		  		expect(fullfilled).toEqual(false)
		  		expect(fullfillmentTx).toEqual(null)
		  		expect(fullfillmentTimestamp).toEqual(null)
		  	}

 			async function testCreateWithSubscriptions() {
	 			recordKey = getSerializedRecordKey(actualCreateResponse.publishingId)

	 			console.log(recordKey)

	 			libp2p.pubsub.subscribe(recordKey)

	 			let expectedSeqNum = 0
				
				let resolveCreateCampaignIpnsTest
				const ipnsCreateCampaignTestPromise = new Promise((resolve) => {
					resolveCreateCampaignIpnsTest = resolve
				})

	 			const ipnsCreateCampaignTest = async (msg) => {

	 				console.log("BismAllah")

	 				try {
					  
						const ipnsRecord = unmarshalIpnsMessage(msg)
						expect(ipnsRecord.sequence).toBeGreaterThanOrEqual(seqNum)
						expectedSeqNum = ipnsRecord.sequence

					    const cid = ipnsRecord.value.toString().replace('/ipfs/', '')

			 			const contributionsJson = await cat(ipfs, cid + "/contributions.json")
				        const fullfillmentJson = await cat(ipfs, cid + "/fullfillment.json")
					      
				        const contributions = JSON.parse(new TextDecoder().decode(contributionsJson))
				        const { fullfilled, fullfillmentTx, fullfillmentTimestamp } = JSON.parse(new TextDecoder().decode(fullfillmentJson))
				  	
				  		expect(contributions).toBe([])
				  		expect(fullfilled).toBe(false)
				  		expect(fullfillmentTx).toBe(null)
				  		expect(fullfillmentTimestamp).toBe(null)

				  		resolveCreateCampaignIpnsTest()

					} catch (err) {
						
						fail(err)
					
					} finally {
					    
					    libp2p.pubsub.removeListener(recordKey, ipnsCreateCampaignTest)
					}
	 			}

	 			libp2p.pubsub.on(recordKey, ipnsCreateCampaignTest)
	 			await ipnsCreateCampaignTestPromise
	 		}

 			const submitConn = await libp2p.dialProtocol("/ip4/0.0.0.0/tcp/4465/p2p/" + ipfsId, "/flipstarter/submit")
 			const testTransaction = {
		 		txHash: "4da543d3866ee0015a5dc2131de7a20ef8966eeaaf2875b24c7bc575ce5d9e60",
				txIndex: 0,
				unlockingScript: "483045022100c221c2676e1b3a5ee7eab5a68351d4e1b368d3c49b9a09d04f8920b66545a559022063cc58d00594c409b07cd2243cf95ae203a29be5d0eae18bb6def64e9bad298cc12103c00d6cbc1712b782b8f9a6388d5ba7567457766fc7be0594bf52a87d3ee0ee5d",
				seqNum: 4294967295,
				scriptHash: '7a78f4a211778baeff95942c6df00cf1ab95e66d585d10c7877b9ad6ddb7298e',
				scriptPubKey: "76a914543a6f75dea3841ac24aac3a7e1633878abb66e188ac",
				satoshis: 465
		 	}

 			const actualSubmissionResponse = await requestStream(submitConn, { 
 				campaignId: actualCreateResponse.publishingId,  
 				contribution: {
 					data: {
 						amount: 465
 					},
 					inputs: [{
						previous_output_transaction_hash: testTransaction.txHash,
						previous_output_index: testTransaction.txIndex,
						unlocking_script: testTransaction.unlockingScript,
						sequence_number: testTransaction.seqNum
 					}]
 				}
 			})

 			expect(actualSubmissionResponse).toEqual({ ok: true })

 			{
 				await new Promise((resolve) => setTimeout(resolve, 5000))
	 			const result = await resolveIPNSKey(ipfs, actualCreateResponse.publishingId, { nocache: true })
				const cid = result.toString().replace('/ipfs/', '')

		 		const contributionsJson = await cat(ipfs, cid + "/contributions.json")
			    const fullfillmentJson = await cat(ipfs, cid + "/fullfillment.json")
				  
			    const contributions = JSON.parse(new TextDecoder().decode(contributionsJson))
			    const { fullfilled, fullfillmentTx, fullfillmentTimestamp } = JSON.parse(new TextDecoder().decode(fullfillmentJson))
				const expectedCommitment = {
					txHash: "hash",
					txIndex: 0,
					satoshis: 465
				}

			  	expect(contributions).toEqual([{ 
	 				alias: "",
	 				campaignId: actualCreateResponse.publishingId,
	 				comment: "",
	 				commitments: [{
	 					campaignId: actualCreateResponse.publishingId,
						txHash: testTransaction.txHash,
						txIndex: testTransaction.txIndex,
						unlockingScript: testTransaction.unlockingScript,
						lockingScript: testTransaction.scriptPubKey,
						scriptHash: testTransaction.scriptHash,
						seqNum: 0xffffffff,
						satoshis: 465
	 				}],
	 				satoshis: 465,
	 				timestamp: expectedTimestamp.unix()
	 			}])

			  	expect(fullfilled).toEqual(false)
			  	expect(fullfillmentTx).toEqual(null)
			  	expect(fullfillmentTimestamp).toEqual(null)
			}

 			async function testSubmitWithSubscriptions() {

				let resolveIpnsSubmitContributionTest
				const ipnsSubmitContributionTestPromise = new Promise((resolve) => {
					resolveIpnsSubmitContributionTest = resolve
				})
				const ipnsSubmitContributionTest = async (msg) => {

	 				try {
						  
					  	const ipnsRecord = unmarshalIpnsMessage(message)
						expect(ipnsRecord.sequence).toBeGreaterThanOrEqual(seqNum)
						expectedSeqNum = ipnsRecord.sequence

					    const cid = ipnsRecord.value.toString().replace('/ipfs/', '')

	 					const contributionsJson = await cat(ipfs, cid + "/contributions.json")
		        		const fullfillmentJson = await cat(ipfs, cid + "/fullfillment.json")
			    		  
		        		const contributions = JSON.parse(new TextDecoder().decode(contributionsJson))
		        		const { fullfilled, fullfillmentTx, fullfillmentTimestamp } = JSON.parse(new TextDecoder().decode(fullfillmentJson))
		  			
		  				expect(contributions).toBe([{
		
		  				}])

		  				expect(fullfilled).toBe(false)
		  				expect(fullfillmentTx).toBe(null)
		  				expect(fullfillmentTimestamp).toBe(null)

						resolveIpnsSubmitContributionTest()

					} catch (err) {
						
						fail(err)
					
					} finally {
					    
					    libp2p.pubsub.removeListener(recordKey, ipnsSubmitContributionTest)
					}
				}

	 			libp2p.pubsub.on(recordKey, ipnsSubmitContributionTest)
	 			await ipnsSubmitContributionTestPromise
	 		}

 		} catch (error) {
 			fail(error)
 		} finally {
 			recordKey && libp2p.pubsub.unsubscribe(recordKey)
 		}
 	})

 	afterAll(async () => {
 		await libp2p.stop()
 		
 		try {

	 		const campaigns = await ipfs.config.get("campaigns")
	 		const keys = await ipfs.config.get("keys")

	 		removeCampaigns.forEach(async (id) => {
	 			const campaign = campaigns[id]
	 			delete campaigns[id]
	 			delete keys[id] 

	 			const keyring = await ipfs.key.list()
	 			const name = keyring.find(key => key.id === id).name
	 			await ipfs.key.rm(name)
	 		})

	 		await ipfs.config.set("campaigns", campaigns)
	 		await ipfs.config.set("keys", keys)

 		} catch(ex) {
 			console.log("Teardown failed")
 			console.log(ex)
 		}
 	})
})
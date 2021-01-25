const CampaignService = require('../src/FlipstarterCampaignService')
const { FlipstarterCommitmentWatcher, FlipstarterErrors } = require('flipstarter-campaign-utilities')
const moment = require('moment')
const MockDate = require('mockdate')
/**
 * Admin dashboard tests
 * 
 * @group campaign-service
 */
 describe('Campaign Service', () => {
 	let campaignId = "fakeId"
 	let contibutionData = {
 		amount: 465
 	}
 	let contributionInputs = [{ 
		previous_output_transaction_hash: "4da543d3866ee0015a5dc2131de7a20ef8966eeaaf2875b24c7bc575ce5d9e60",
		previous_output_index: 0,
		unlocking_script: "483045022100c221c2676e1b3a5ee7eab5a68351d4e1b368d3c49b9a09d04f8920b66545a559022063cc58d00594c409b07cd2243cf95ae203a29be5d0eae18bb6def64e9bad298cc12103c00d6cbc1712b782b8f9a6388d5ba7567457766fc7be0594bf52a87d3ee0ee5d",
		sequence_number: 4294967295,
 	}]
 	let recipients = [{
 		address: "bchtest:qqekcwxmfzhgn775r6t382g08mx4cxclfsd2d2v0x0",
		satoshis: 558
	}]

 	it('should fail with ContributionVerificationError if contribution or campaign id is undefined', async () => {
 		
 		const Repository = jest.createMockFromModule("../src/FlipstarterIpfsRepository")
 		const repository = new Repository()
 		repository.getCampaign.mockResolvedValue({ 
 			fullfilled: false,
 			starts: moment().unix(),
 			expires: moment().add(1, 'days').unix(),
 			recipients
 		})

 		try {
 			
 			const campaignService = new CampaignService(repository)
 			await campaignService.handleContribution()

 		} catch (error) {
 			
 			expect(error).toBeInstanceOf(FlipstarterErrors.ContributionVerificationError)
 		}
 	})

 	it('should fail with CampaignDoesNotExistError if contribution is null', async () => {
 		
 		const Repository = jest.createMockFromModule("../src/FlipstarterIpfsRepository")
 		const repository = new Repository()
 		repository.getCampaign.mockResolvedValue(undefined)

 		try {
 			
 			const campaignService = new CampaignService(repository)
 			await campaignService.handleContribution(campaignId, contibutionData, contributionInputs)

 		} catch (error) {

 			expect(error).toBeInstanceOf(FlipstarterErrors.CampaignDoesNotExistError)
 		}
 	})

 	it('should fail with CampaignFullfilledError if campaign is fullfilled', async () => {
 		
 		const Repository = jest.createMockFromModule("../src/FlipstarterIpfsRepository")
 		const repository = new Repository()
 		repository.getCampaign.mockResolvedValue({ 
 			fullfilled: true,
 			recipients 
 		})

 		try {

 			const campaignService = new CampaignService(repository)
 			await campaignService.handleContribution(campaignId, contibutionData, contributionInputs)

 		} catch (error) {

 			expect(error).toBeInstanceOf(FlipstarterErrors.CampaignFullfilledError)
 		}
 	})

 	it('should fail with CampaignExpiredError if campaign is expired', async () => {
 		
 		const Repository = jest.createMockFromModule("../src/FlipstarterIpfsRepository")
 		const repository = new Repository()
 		repository.getCampaign.mockResolvedValue({ 
 			fullfilled: false,
 			expires: moment().subtract(1, 'days').unix() ,
 			recipients
 		})

 		try {

 			const campaignService = new CampaignService(repository)
 			await campaignService.handleContribution(campaignId, contibutionData, contributionInputs)

 		} catch (error) {

 			expect(error).toBeInstanceOf(FlipstarterErrors.CampaignExpiredError)
 		}
 	})

 	it('should fail with CampaignExpiredError if campaign is expired', async () => {
 		
 		const Repository = jest.createMockFromModule("../src/FlipstarterIpfsRepository")
 		const repository = new Repository()
 		repository.getCampaign.mockResolvedValue({ 
 			fullfilled: false,
 			starts: moment().add(1, 'days').unix(),
 			expires: moment().add(2, 'days').unix(),
 			recipients
 		})

 		try {

 			const campaignService = new CampaignService(repository)
 			await campaignService.handleContribution(campaignId, contibutionData, contributionInputs)

 		} catch (error) {
 			
 			expect(error).toBeInstanceOf(FlipstarterErrors.CampaignNotStartedError)
 		}
 	})

 	it('should handle valid contribution', async () => {
 		const Repository = jest.createMockFromModule("../src/FlipstarterIpfsRepository")
        const expectedTimestamp = moment()

        MockDate.set(expectedTimestamp.valueOf())

 		const repository = new Repository()
 		repository.getCampaign.mockResolvedValue({
 			fullfilled: false,
 			starts: moment().unix(),
 			expires: moment().add(1, 'days').unix(),
 			recipients,
 			contributions: []
 		})

		const validateCommitmentMock = jest.fn()
		const fullfillCampaignMock = jest.fn()
		const expectedCommitment = {
			txHash: "hash",
			txIndex: 0,
			satoshis: 465
		}

 		validateCommitmentMock.mockResolvedValue(expectedCommitment)

 		try {
 			
 			const campaignService = new CampaignService(repository)
 			const result = await campaignService.handleContribution(campaignId, contibutionData, contributionInputs, validateCommitmentMock, fullfillCampaignMock)
 			expect(result).toEqual({ 
 				alias: "",
 				campaignId: campaignId,
 				comment: "",
 				commitments: [{
 					campaignId,
 					...expectedCommitment
 				}],
 				satoshis: 465,
 				timestamp: expectedTimestamp.unix()
 			})

 			expect(validateCommitmentMock).toHaveBeenCalled()

 		} catch (error) {
 			fail(error)
 		}
 	})
 })
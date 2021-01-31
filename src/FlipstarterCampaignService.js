const moment = require('moment')
const { FlipstarterErrors } = require('flipstarter-campaign-utilities')
const AggregateError = require('aggregate-error')

module.exports = class FlipstarterCampaignService {

  constructor(repository, watcher) {
    this.repository = repository
  }

  async getCampaign(campiagnId) {
    return await this.repository.getCampaign(campaignId)
  }

  async handleCampaignCreation(campaignData) {
    const hasData = !!campaignData && !isNaN(Number(campaignData.starts)) && !isNaN(Number(campaignData.expires))
    const hasRecipients = hasData && campaignData.recipients && campaignData.recipients.length && campaignData.recipients.every(r => {
      //TODO God willing: validate addresses and satoshis (more than dust)
      return r.address && r.satoshis
    })

    if (!hasData || !hasRecipients) {
      throw "Invalid campaign data"
    }

  	const recipients = campaignData.recipients.map(recipient => {
      return {
        name: recipient.name,
        url: recipient.url,
        image: recipient.image,
        alias: recipient.alias,
        address: recipient.address,
        signature: recipient.signature,
        satoshis: recipient.satoshis,
      }
    })

    const getDescriptionLanguage = (code) => {
      const description = campaignData.descriptions && campaignData.descriptions[code] || {}
      return {
        abstract: description.abstract || "",
        proposal: description.proposal || ""
      }
    }

  	const campaign = {
      title: campaignData.title,
      starts: Number(campaignData.starts),
      expires: Number(campaignData.expires),
      recipients,
      descriptions: {
        en: getDescriptionLanguage("en"),
        es: getDescriptionLanguage("es"),
        zh: getDescriptionLanguage("zh"),
        ja: getDescriptionLanguage("ja")
      }
    }

    return await this.repository.createCampaign(campaign)
  }

  async handleContribution(campaignId, contributionData, contributionInputs = [], validateCommitment, fullfillCampaign) {
    
    if (!campaignId) {
      throw new FlipstarterErrors.ContributionVerificationError("Invalid campaign id")
    }

    const campaign = await this.repository.getCampaign(campaignId)

    contributionData = contributionData || {}

    if (!contributionInputs || !contributionInputs.length) {
      throw new FlipstarterErrors.ContributionVerificationError("No valid contribution inputs")
    }

    // If there is no matching campaign..
    if (typeof campaign === "undefined" || !campaign.recipients || !campaign.recipients.length) {
      // Send an BAD REQUEST signal back to the client.
       throw new FlipstarterErrors.CampaignDoesNotExistError(campaignId)
    }

    // Check if the campaign has already been fullfilled.
    if (campaign.fullfilled) {
      // Send an BAD REQUEST signal back to the client.
      throw new FlipstarterErrors.CampaignFullfilledError(campaignId)
    }

    // Check if the campaign has already expired.
    if (!campaign.expires || moment().unix() >= campaign.expires) {
      // Send an BAD REQUEST signal back to the client.
      throw new FlipstarterErrors.CampaignExpiredError(campaignId)
    }

    // Check if the campaign has not yet started.
    if (!campaign.starts || moment().unix() < campaign.starts) {
      // Send an BAD REQUEST signal back to the client.
      throw new FlipstarterErrors.CampaignNotStartedError(campaignId)
    }

    const existingCommitments = FlipstarterCampaignService.getUnrevokedCommitments(campaign)
    const currentCommittedSatoshis = getCommittedSatoshis(existingCommitments)
    const currentCommitmentCount = existingCommitments.length

    const contribution = {
      alias: contributionData.alias || "",
      comment: contributionData.comment || "",
      commitments: [],
      satoshis: 0,
      campaignId: campaignId,
      timestamp: moment().unix()
    }

    const self = this
    
    let failedCommitmentErrors = []
    const { committedSatoshis:nextCommittedSatoshis } = await contributionInputs.reduce(async ({ committedSatoshis, commitmentCount }, input) => {
    	
      let commitment

      try {

    	  const commitmentData = {
          txHash: input.previous_output_transaction_hash,
          txIndex: input.previous_output_index,
          unlockingScript: input.unlocking_script,
          seqNum: input.sequence_number
        }

        commitment = await validateCommitment(campaign.recipients, committedSatoshis, commitmentCount, commitmentData)
        commitment.campaignId = campaignId

      } catch (error) {

        // Ignore error until all are processed
        failedCommitmentErrors.push(error)
        console.log(error)
      }

      if (!isValidCommitment(commitment)) {
        failedCommitmentErrors.push(new Error("Invalid commitment"))
        return { committedSatoshis, commitmentCount }
      }

      if (doesCommitmentExist(existingCommitments, commitment) || doesCommitmentExist(contribution.commitments, commitment)) {
        failedCommitmentErrors.push(new Error("Duplicate commitment"))
        return { committedSatoshis, commitmentCount }
      }

    	contribution.satoshis += commitment.satoshis
    	contribution.commitments.push(commitment)

       return { 
         committedSatoshis: committedSatoshis + commitment.satoshis,
         commitmentCount: commitmentCount + 1
       }

    }, { 
    	committedSatoshis: currentCommittedSatoshis,
    	commitmentCount: currentCommitmentCount
    })
    
    // Check that at least some commitment validated
    if (!contribution.commitments.length) {
      throw new AggregateError(failedCommitmentErrors)
    }

    // Verify that contributed amount matches stated intent unless it's customized
    if (!failedCommitmentErrors.length && contributionData.amount !== Math.round(contribution.satoshis)) {
      // Send an CONFLICT signal back to the client.
      throw new FlipstarterErrors.ContributionIntentMismatchError(Math.round(contribution.satoshis), contributionData.amount)
    }

    campaign.contributions.push(contribution)

    const requestedSatoshis = getRequestedSatoshis(campaign)

    if (nextCommittedSatoshis >= requestedSatoshis) {
      const commitments = FlipstarterCampaignService.getUnrevokedCommitments(campaign)
      const result = await fullfillCampaign(commitments)
      if (result) {
        // If we successfully broadcasted the transaction..
        campaign.fullfilled = true
        campaign.fullfillmentTx = txHash
        campaign.fullfillmentTimestamp = moment().unix()
      }
    }

    const updatedCampaign = await this.repository.updateCampaign(campaign)
    return { campaign: updatedCampaign, contribution }
  }

  async handleRevocation(commitment) {
	  // Mark the commitment as revoked.
	  console.log(`Marked spent commitment '${commitment.txHash}' as revoked.`)

	  const campaign = await this.repository.getCampaign(commitment.campaignId)

	  for (let i = 0; i < campaign.contributions.length; i++) {

	    const contribution = campaign.contributions[i]

	    const foundIndex = contribution.commitments.findIndex(c => {
	      return c.txHash === commitment.txHash && c.txIndex === commitment.txIndex
	    })

	    if (foundIndex !== -1) {

	      contribution.commitments[foundIndex] = {
	        ...contribution.commitments[foundIndex],
	        revoked: true,
	        revokeTimestamp: moment().unix()
	      }
	  	
	  	  return await this.repository.updateCampaign(campaign)
	    }
	  }
  }

  static getUnrevokedCommitments(campaign) {
    
    return (campaign.contributions || []).reduce((commitments, contribution) => {

      commitments = commitments.concat(contribution.commitments.filter(commitment => !isCommitmentRevoked(campaign, commitment)))
      return commitments

    }, []);
  }
}

function isCommitmentRevoked(campaign, commitment) {
  return commitment.revoked && (!campaign.fullfilled || commitment.revokeTimestamp < campaign.fullfillmentTimestamp)
}

function isValidCommitment(commitment) {
  return !!commitment && Number.isInteger(commitment.satoshis) && !!commitment.txHash && Number.isInteger(commitment.txIndex)
}

function doesCommitmentExist(commitments, commitment) {
  return commitments.findIndex(c => commitment.txHash === c.txHash && commitment.txIndex === c.txIndex && commitment.campaignId === c.campaignId) !== -1
}

function getCommittedSatoshis(commitments) {
  return commitments.reduce((sum, commitment) => {
    return sum + commitment.satoshis
  }, 0)
}

function getRequestedSatoshis(campaign) {
  return campaign.recipients.reduce((sum, recipient) => {
    return sum + recipient.satoshis
  }, 0)
}
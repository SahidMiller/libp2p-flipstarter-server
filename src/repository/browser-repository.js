const { Mutex } = require("async-mutex")

const getSerializedRecordKey = require('../utils/ipns/get-record-key')
const { startRemoteListeners, waitForRemoteListeners } = require('../utils/ipns/remote-listener-utils')
const { cat, uploadFile, uploadDirectory, genKey } = require('../utils/ipfs')

module.exports = class FlipstarterIpfsRepository {
  constructor(ipfs, preloadNodes) {
    this.ipfs = ipfs
    this.preloadNodes = preloadNodes
  }

  async getCampaigns() {
    const ipfs = this.ipfs
    const campaigns = await getCampaignMap(ipfs)
    const campaignIds = Object.keys(campaigns)

    return (await Promise.all(campaignIds.map(async (campaignId) => {
      
      try {
        
        return await this.getCampaign(campaignId)

      } catch (error) {
        
        console.log("Error fetching campaign " + campaignId, error)
      }

    }))).filter(Boolean)
  }


  async getCampaign(campaignId) {
    const ipfs = this.ipfs

    try {
      
      const campaigns = await getCampaignMap(ipfs)

      const result = campaigns[campaignId]
      const { campaign, campaignCid } = result

      campaign.id = campaignId
      const contributionsJson = await cat(ipfs, campaignCid + "/contributions.json")
      const fullfillmentJson = await cat(ipfs, campaignCid + "/fullfillment.json")
      const contributions = JSON.parse(new TextDecoder().decode(contributionsJson))
      const fullfillmentInfo = JSON.parse(new TextDecoder().decode(fullfillmentJson))

      return { ...campaign, ...fullfillmentInfo, contributions }

    } catch (error) {
      
      console.log("Error fetching campaign " + campaignId, error)
    }
  }

  async updateCampaign(campaign) {
    //Get existing campaign before overwriting config
    const campaigns =  await getCampaignMap(this.ipfs)
    const result = campaigns[campaign.id]

    if (!result) {
      throw "updating campaign that doesn't exist: " + campaign.id
    }
    
    return await updateCampaignSite(this.ipfs, this.preloadNodes, campaign)
  }

  async updateCampaigns() {
    const campaignIds = Object.keys(await getCampaignMap(this.ipfs))
    const self = this
    return await Promise.all(campaignIds.map(async (campaignId) => {
      const campaign = await self.getCampaign(campaignId)
      return updateCampaignSite(self.ipfs, self.preloadNodes, campaign)
    }))
  }

  async createCampaign(campaign) {
    const ipfs = this.ipfs
    const preloadNodes = this.preloadNodes
    const keyName = getKey(campaign)
    const keys = await ipfs.key.list()
    

    if (keys.find(k => k.name === keyName)) {
      throw "campaign id already exists"
    }

    const key = await genKey(ipfs, keyName)

    try {

      await newCampaignSite(ipfs, key.id, campaign)
      return await updateCampaignSite(ipfs, preloadNodes, {
        id: key.id,
        contributions: [], 
        fullfilled: false,
        fullfillmentTx: null,
        fullfillmentTimestamp: null
      })
    
    } catch(error) {
      
      await ipfs.key.rm(keyName)
      await removeCampaignSite(ipfs, key.id)

      throw error
    }
  }
}

function getKey(campaign) {
    const recipientKeys = campaign.recipients.sort((a, b) => a.satoshis - b.satoshis).map(r => r.address.replace(":", "-") + "-" + r.satoshis)
    return campaign.starts + "-" + campaign.expires + "-" + recipientKeys.join()
}

async function getCampaignMap(ipfs) {
  let campaigns = {}

  try {

    campaigns = await ipfs.config.get("campaigns")

  } finally {

    return campaigns
  }
}

const campaignsWriteLock = new Mutex();
async function newCampaignSite(ipfs, campaignId, campaign) {

  const unlock = await campaignsWriteLock.acquire();
  
  try {
  
    const campaigns = await getCampaignMap(ipfs) 
    campaign.id = campaignId
    campaigns[campaignId] = { campaign, seqNum: 0 }
    await ipfs.config.set("campaigns", campaigns)

  } finally {
    unlock()
  }
}

async function updateCampaignSite(ipfs, preloadNodes, campaign) {
  const fullfillmentInfo = { 
    fullfilled: campaign.fullfilled || false,
    fullfillmentTx: campaign.fullfillmentTx || null,
    fullfillmentTimestamp: campaign.fullfillmentTimestamp || null
  }

  const contributions = campaign.contributions || []

  const [contributionsLink, fullfillmentLink] = await Promise.all([
    uploadFile(ipfs, "contributions.json", JSON.stringify(contributions)),
    uploadFile(ipfs, "fullfillment.json", JSON.stringify(fullfillmentInfo))
  ])

  const { Hash: campaignCid } = await uploadDirectory(ipfs, "", [contributionsLink, fullfillmentLink])
  
  const unlock = await campaignsWriteLock.acquire();
  let sequenceNum
  let existingCampaign

  try {

    const campaigns = await getCampaignMap(ipfs) 
    const storedCampaignInfo = campaigns[campaign.id]
    sequenceNum = storedCampaignInfo.seqNum
    existingCampaign = storedCampaignInfo.campaign
    campaigns[campaign.id] = { campaign: existingCampaign, campaignCid, seqNum: sequenceNum + 1 }
    await ipfs.config.set("campaigns", campaigns)
  
  } finally {

    unlock()
  }
  
  const keyName = getKey(existingCampaign)
  await updateIPNS(ipfs, preloadNodes, campaign.id, keyName, sequenceNum, campaignCid)

  return { ...existingCampaign, ...fullfillmentInfo, contributions }
}

async function removeCampaignSite(ipfs, campaignId) {

  const unlock = await campaignsWriteLock.acquire()

  try {
    
    const campaigns = await getCampaignMap(ipfs)
    delete campaigns[campaignId]
    await ipfs.config.set("campaigns", campaigns)

  } finally {
     unlock()
  }
}

async function updateIPNS(ipfs, preloadNodes, keyId, keyName, seqNum = 0, cid) {
  const recordKey = getSerializedRecordKey(keyId);

  startRemoteListeners(preloadNodes, keyId)
  await waitForRemoteListeners(ipfs, recordKey, (attempt, peers) => {
    return attempt < preloadNodes.length ? peers.length >= preloadNodes.length - attempt : peers.length >= 1
  })

  await ipfs.name.publish(cid, { key: keyName, resolve: false })
}
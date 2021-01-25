const CID = require('cids')
const { updateIPNS } = require('./utils/ipns')
const { cat, uploadFile, uploadDirectory, genKey } = require('./utils/ipfs')
const { hashData } = require('./utils/dag')
const { Mutex } = require("async-mutex")
const crypto = require('libp2p-crypto')
const multibase = require('multibase')

//Since no IPFS key export/import
const fs = require('fs')
const path = require('path')

module.exports = class FlipstarterIpfsRepository {
  constructor(ipfs, libp2p) {
    this.ipfs = ipfs
    this.libp2p = libp2p
  }

  getKey(campaign) {
      const recipientKeys = campaign.recipients.sort((a, b) => a.satoshis - b.satoshis).map(r => r.address + "-" + r.satoshis)
      return campaign.starts + "-" + campaign.expires + "-" + recipientKeys.join()
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
    
    const keys = await this.ipfs.config.get("keys")
    const pem = keys[campaign.id]
    const privateKey = await crypto.keys.import(pem, "temppassword")
    
    return await updateCampaignSite(this.ipfs, this.libp2p, campaign, privateKey)
  }

  async updateCampaigns() {
    const campaigns =  await getCampaignMap(ipfs)
    const keys = await this.ipfs.config.get("keys")
    const self = this
    return await Promise.all(Object.keys(campaigns).map(async (campaignId) => {
      const campaign = campaigns[campaignId]
      const privateKey = await crypto.keys.import(keys[campaignId], "temppassword")
      return updateCampaignSite(self.ipfs, self.libp2p, campaign, privateKey)
    }))
  }

  async createCampaign(campaign) {
    const ipfs = this.ipfs

    const keyName = this.getKey(campaign)
    const keys = await ipfs.key.list()

    if (keys.find(k => k.name === keyName)) {
      throw "campaign id already exists"
    }

    //Generating key in ipfs then importing it
    const key = await genKey(ipfs, keyName)

    try {

      const fileName = "key_" + multibase.names.base32.encode(new TextEncoder().encode(keyName))
      const { repoPath } = await ipfs.repo.stat()

      const privateKey = await crypto.keys.unmarshalPrivateKey(fs.readFileSync(path.join(repoPath, "keystore", fileName)))
      const pem = await privateKey.export('temppassword')

      addKey(ipfs, key.id, pem)

      await newCampaignSite(ipfs, key.id, campaign)
      await updateCampaignSite(ipfs, this.libp2p, {
        id: key.id,
        contributions: [], 
        fullfilled: false,
        fullfillmentTx: null,
        fullfillmentTimestamp: null
      }, privateKey)
    
    } catch(error) {
      
      await ipfs.key.rm(keyName)
      await removeCampaignSite(ipfs, key.id)
      await removeKey(ipfs, key.id)

      throw error
    }

    return key.id
  }
}

async function getCampaignMap(ipfs) {
  let campaigns = {}

  try {

    campaigns = await ipfs.config.get("campaigns")

  } finally {

    return campaigns
  }
}

async function getKeys(ipfs) {
  let keys = {}

  try {

    keys = await ipfs.config.get("keys")

  } finally {

    return keys
  }
}

const keysWriteLock = new Mutex();
async function addKey(ipfs, id, pem) {

  const unlock = await keysWriteLock.acquire();
  
  try {
  
    const keys = await getKeys(ipfs)
    keys[id] = pem
    await ipfs.config.set("keys", keys)

  } finally {
    unlock()
  }
}

async function removeKey(ipfs, id) {

  const unlock = await keysWriteLock.acquire();
  
  try {
  
    const keys = await getKeys(ipfs)
    delete keys[id]
    await ipfs.config.set("keys", keys)

  } finally {
    unlock()
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

async function updateCampaignSite(ipfs, libp2p, campaign, privateKey) {
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

  try {

    const campaigns = await getCampaignMap(ipfs) 
    const { campaign:existingCampaign, seqNum } = campaigns[campaign.id]
    sequenceNum = seqNum
    campaigns[campaign.id] = { campaign: existingCampaign, campaignCid, seqNum: seqNum + 1 }
    await ipfs.config.set("campaigns", campaigns)
  
  } finally {

    unlock()
  }
  
  await updateIPNS(ipfs, libp2p, privateKey, campaign.id, sequenceNum, campaignCid)

  return { ...campaign, ...fullfillmentInfo, contributions }
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
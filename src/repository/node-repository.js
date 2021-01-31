const { Mutex } = require("async-mutex")
const crypto = require('libp2p-crypto')
const multibase = require('multibase')
const ipns = require('ipns')

const getSerializedRecordKey = require('../utils/ipns/get-record-key')
const { startRemoteListener, startRemoteListeners, waitForRemoteListeners } = require('../utils/ipns/remote-listener-utils')
const { cat, uploadFile, uploadDirectory, genKey } = require('../utils/ipfs')

//Since IPFS remote key export/import unsupported, read from file
const fs = require('fs')
const path = require('path')

module.exports = class FlipstarterIpfsRepository {
  constructor(ipfs, preloadNodes) {
    this.ipfs = ipfs
    this.preloadNodes = preloadNodes
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
    const privateKey = await crypto.keys.import(pem, __KEYEXPORT_PASS__)
    
    return await updateCampaignSite(this.ipfs, this.preloadNodes, campaign, privateKey)
  }

  async updateCampaigns() {
    const campaignIds = Object.keys(await getCampaignMap(this.ipfs))
    const keys = await this.ipfs.config.get("keys")
    const self = this

    return await Promise.all(campaignIds.map(async (campaignId) => {
      const campaign = await self.getCampaign(campaignId)
      const privateKey = await crypto.keys.import(keys[campaignId], __KEYEXPORT_PASS__)
      return updateCampaignSite(self.ipfs, self.preloadNodes, campaign, privateKey)
    }))
  }

  async createCampaign(campaign) {
    const ipfs = this.ipfs
    const preloadNodes = this.preloadNodes
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

      //TODO God willing
      const privateKey = await crypto.keys.unmarshalPrivateKey(fs.readFileSync(path.join(repoPath, "keystore", fileName)))
      const pem = await privateKey.export(__KEYEXPORT_PASS__)

      await addKey(ipfs, key.id, pem)

      await newCampaignSite(ipfs, key.id, campaign)
      return await updateCampaignSite(ipfs, preloadNodes, {
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

async function updateCampaignSite(ipfs, preloadNodes, campaign, privateKey) {
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
  
  await updateIPNS(ipfs, preloadNodes, privateKey, campaign.id, sequenceNum, campaignCid)

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

async function updateIPNS(ipfs, preloadNodes, privateKey, keyId, seqNum = 0, cid) {
  const recordKey = getSerializedRecordKey(keyId);

  await ipfs.libp2p.pubsub.subscribe(recordKey)

  startRemoteListener(ipfs, keyId)
    
  const localId = ipfs.libp2p.peerId.toB58String()
  await waitForRemoteListeners(ipfs, recordKey, (attempt, peers) => {
    const found = !!peers.find(peer => peer === localId)
    return found
  })

  startRemoteListeners(preloadNodes, keyId)

  const hourMs = 60 * 60 * 1000
  const record = await ipns.create(privateKey, cid, seqNum, hourMs);
  const recordData = ipns.marshal(record);
    
  //If we're connected via pubsub with our gateway and the gateway has the key 
  //    then publishing via pubsub should hook into their own republisher, God willing.
  await ipfs.libp2p.pubsub.publish(recordKey, recordData);
}
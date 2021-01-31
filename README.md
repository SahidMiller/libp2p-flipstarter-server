README.md

# libp2p-flipstarter-server

libp2p-flipstarter-server is a portable flipstarter server for accepting contributions using libp2p as a connection manager. This can be run in the browser and node.

## Concepts

Libp2p Flipstarter Server simply manages accepting, validating, and sharing contributions. Campaigners can create a simple frontend for their campaign and use this api for donors to send contributions to. It is purposefully divorced from campaign frontends so recipient addresses and amounts aren't tampered with.

This API makes heavy use of IPNS and Libp2p.

Browser and node versions will use IPNS preload nodes to publish IPNS updates of contributions and fulfillment info. 
Browser and node versions are capable of using circuit-relay for communication, node version can expose websocket and other libp2p interfaces...
Node version will also use a local IPFS node connection for republishing to the DHT.

Naturally, the browser version will need the tab to be always on to accept donations for any hosted campaigns.

## Installation

### Node
```
npm install libp2p-flipstarter-server -g 
```

### Browser 

```
npm install libp2p-flipstarter-server
```

## Usage

### Node

See configuration options for exposing ports.

```
libp2p-flipstarter-server --config=./server-config.json
```

### Browser

Returns a FlipstarterServer class that extends EventEmitter.

#### Load the library
```
import FlipstarterServer from 'libp2p-flipstarter-server'
```

#### Instantiate the server

```
  const ipfs = await createIpfs()
  const electrum = await createElectrum()
  const server = new FlipstarterServer(ipfs, electrum, {
    useRelayBootstrappers: true,
    updateBootstrappersInterval: tenMinutes,
    republishCampaignsInterval: tenMinutes,
    preloadNodes: []
  })
```

#### Add event hooks
```
  server.on('campaign-updated', (campaign) => {})
  server.on('campaign-created', (campaign) => {})
  server.on('relays-updated', (relays) => {})

  const { campaigns, relays } = await server.start()
```

## Configuration

### Browser
|Name|Required|Type|Default|Description|
|:--:|:-----:|:--:|:-----:|:----------|
|**`useRelayBootstrappers`**|no|`{boolean}`|`true`| Flag whether to query bootstrap list for circuit-relay capabilities and return to the user. This should be true in a browser context. |
|**`updateBootstrappersInterval`**|yes|`{int}`|`600000 (ten minutes)`| Interval to update bootstrappers list and refresh connections |
|**`republishCampaignsInterval`**|yes|`{string}`|`3600000 (one hour)`| Interval to republish campaigns via libp2p after refreshing preload node IPNS subscriptions|
|**`preloadNodes`**|yes|`{string}`|`[]`|Preload nodes to connect with via IPFS API to relay IPNS pubsub messages|

### Node

Production server usage will require IPFS and HTTPS (nginx reverse proxy)

For server usage, pass a config file with the following properties:

|Name|Required|Type|Default|Description|
|:--:|:-----:|:--:|:-----:|:----------|
|**`__REMOTE_API_ADDRESS__`**|yes|`{string}`|`http://localhost:5001`| Local IPFS instance's API for storing data and republishing IPNS (must be running on same machine) |
|**`__REMOTE_MULTI_ADDRESS__`**|yes|`{string}`|`undefined`|Local IPFS instance's multiaddress for libp2p to communicate with |
|**`__RSA_KEY__`**|yes|`{string}`|`[]`|Current libp2p RSA key in PEM format (used to derive public key)|
|**`__RSA_PASSWORD__`**|yes|`{string}`|`undefined`|Password to decrypt PEM RSA Key|
|**`__USE_BOOTSTRAPPER_RELAY_ADDRESSES__`**|yes|`{boolean}`|`true`|Flag whether to query bootstrap list for circuit-relay capabilities and return to the user|
|**`__PUBLIC_SWARM_ADDRESSES__`**|yes|`{Array<string>}`|`[]`|Public multiaddrs to listen over and share with created campaigns|
|**`__PRIVATE_SWARM_ADDRESSES__`**|yes|`{Array<string>}`|`see below`|Private multiaddrs to listen over and not share with created campaigns|
|**`__ELECTRUM_SERVERS__`**|yes|`{Array<Object>}`|`see below`|Electrum servers in the form of { address, port, scheme } |
|**`__PRELOAD_NODES__`**|yes|`{Array<string>}`|`see below`|IPFS preload nodes to connect to for IPNS ex. node0.preload.ipfs.io |
|**`__KEYEXPORT_PASS__`**|yes|`{string}`|`temppassword`|Password to encrypt generated campaign keys with|

#### Example server config

Pass the config path to --config command line argument or place in root of development folder as `server-config.json`

```
{
	"__REMOTE_API_ADDRESS__": "http://localhost:5001",
	"__REMOTE_MULTI_ADDRESS__": "/ip4/10.0.0.19/tcp/4001/p2p/123Dh...",
	"__RSA_KEY__": "-----BEGIN ENCRYPTED PRIVATE KEY----- ... -----END ENCRYPTED PRIVATE KEY-----",
	"__RSA_PASSWORD__": "testpassword",
	"__USE_BOOTSTRAPPER_RELAY_ADDRESSES__": true,
	"__PUBLIC_SWARM_ADDRESSES__": [],
	"__PRIVATE_SWARM_ADDRESSES__": [
		"/ip4/0.0.0.0/tcp/4003",
		"/ip4/0.0.0.0/tcp/4003/ws",
		"/ip4/0.0.0.0/tcp/4004/wss"
	],
	"__ELECTRUM_SERVERS__": [
		{ "address": "testnet.bitcoincash.network", "port": 60004, "scheme": "wss" },
		{ "address": "blackie.c3-soft.com", "port": 60004, "scheme": "wss" },
		{ "address": "electroncash.de", "port": 60004, "scheme": "wss" }
	],
	"__PRELOAD_NODES__": [
		"http://node0.preload.ipfs.io", 
		"http://node1.preload.ipfs.io", 
		"http://node2.preload.ipfs.io", 
		"http://node3.preload.ipfs.io"
	],
	"__KEYEXPORT_PASS__": "temppassword"
}
```

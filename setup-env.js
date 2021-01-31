const fs = require('fs')
const path = require('path')

module.exports = (configPath) => {
	let config

	try {
		config = JSON.parse(fs.readFileSync(configPath))
	} catch (err) {
		console.log("Error parsing config file: " + configPath)
	}

	const {

		__REMOTE_API_ADDRESS__,
		__REMOTE_MULTI_ADDRESS__,
		__RSA_KEY__,
		__RSA_PASSWORD__,
		__USE_BOOTSTRAPPER_RELAY_ADDRESSES__ = true,
		__PUBLIC_SWARM_ADDRESSES__ = [],
		__PRIVATE_SWARM_ADDRESSES__ = [],
		__ELECTRUM_SERVERS__ = [],
		__PRELOAD_NODES__ = [],
		__KEYEXPORT_PASS__ = "temppassword"

	} = config || {}

	Object.keys(config).forEach(key => {
		global[key] = config[key]
	})
}
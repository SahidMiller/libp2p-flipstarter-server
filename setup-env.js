const fs = require('fs')
const path = require('path')

module.exports = (configPath) => {
	const config = JSON.parse(fs.readFileSync(path.join(__dirname, configPath)))
	Object.keys(config).forEach(key => {
		global[key] = config[key]
	})
}
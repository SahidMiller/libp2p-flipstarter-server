const ipfsClient = require('ipfs-http-client')

const http = require('http')
const https = require('https')

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 6
})
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 6
})

module.exports = async () => await ipfsClient({
	url: __REMOTE_API_ADDRESS__,
	agent: function (parsedURL) {
        // return an agent that allows redirection from http to https
        if (parsedURL.protocol === 'http:') {
          return httpAgent
        } else {
          return httpsAgent
    	}
    }
})
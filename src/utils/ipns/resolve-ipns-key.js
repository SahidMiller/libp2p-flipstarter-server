const last = require('it-last')

module.exports = async function(ipfs, key, options = {}) {
  return await last(ipfs.name.resolve(key, { stream: false, ...options }));
}

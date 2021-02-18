// Load the electrum library.
const { ElectrumCluster, ElectrumTransport } = require("electrum-cash");

module.exports = async ({ confidence = 1, timeout = 60000, name, version = "1.4.1", distribution, order } = {}) => {

  // Initialize an electrum cluster with default settings.
  const electrum = new ElectrumCluster(name, version, confidence, distribution, order, timeout)

  // Add some servers to the cluster.
  const servers = __ELECTRUM_SERVERS__
  servers.forEach(({ address, port, scheme }) => electrum.addServer(address, port, scheme))

  // Wait for enough connections to be available.
  await electrum.ready()

  return electrum
};
const webpack = require("webpack")
const path = require("path")
const RemovePlugin = require('remove-files-webpack-plugin')
const fs = require('fs')

module.exports = (env) => {

	const config = JSON.parse(fs.readFileSync(env.config || path.join(__dirname, "server-config.json")))

	if (!config) {
		throw "Build requires configuration file"
	}

	const {

		__REMOTE_API_ADDRESS__,
		__REMOTE_MULTI_ADDRESS__,
		__RSA_KEY__,
		__RSA_PASSWORD__,
		__USE_BOOTSTRAPPER_RELAY_ADDRESSES__ = true,
		__PUBLIC_SWARM_ADDRESSES__ = [],
		__PRIVATE_SWARM_ADDRESSES__ = [],
		__ELECTRUM_SERVERS__ = []
		
	} = config

	return {
		name: 'server',
		entry: path.join(__dirname, '/src/index.js'),
		target: 'node',
		output: { 
			path: path.join(__dirname, '/dist'),
			filename: "index.js",
			publicPath: ''
		},
		mode: "development",
		watch: false,
		stats: 'errors-only',	
		module: {
			rules: [
				{
					test: /\.(node)$/i,
					loader: 'node-loader',
					options: {
						name: 'build/[name].[ext]'
					}
				}
			]
		},
		resolve: {
			fallback: {
				electron: false,
				'./setup-env': false
			}
		},
		plugins: [
			new RemovePlugin({
				before: {
			        include: [
			            './dist/client'
			        ],
				    log: false,
				    logWarning: true,
				    logError: true,
				    logDebug: false
			    },
			    watch: {
			    	beforeForFirstBuild: true
			    }
			}),
		  	new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
			new webpack.DefinePlugin({
				__REMOTE_API_ADDRESS__: JSON.stringify(__REMOTE_API_ADDRESS__),
				__REMOTE_MULTI_ADDRESS__: JSON.stringify(__REMOTE_MULTI_ADDRESS__),
				__RSA_KEY__: JSON.stringify(__RSA_KEY__),
				__RSA_PASSWORD__: JSON.stringify(__RSA_PASSWORD__),
				__USE_BOOTSTRAPPER_RELAY_ADDRESSES__: JSON.stringify(__USE_BOOTSTRAPPER_RELAY_ADDRESSES__),
				__PUBLIC_SWARM_ADDRESSES__: JSON.stringify(__PUBLIC_SWARM_ADDRESSES__),
				__PRIVATE_SWARM_ADDRESSES__: JSON.stringify(__PRIVATE_SWARM_ADDRESSES__),
				__ELECTRUM_SERVERS__: JSON.stringify(__ELECTRUM_SERVERS__)
		    }),
		    new webpack.NormalModuleReplacementPlugin(
				/\.\.\/setup-env/, 
				"../setup-env-webpack"
			)
	  	]
	}
}
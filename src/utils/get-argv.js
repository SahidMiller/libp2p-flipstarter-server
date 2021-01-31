module.exports = {
	get: (arg) => {
		var argIndex = process.argv.indexOf("--" + arg) + 1;

		if (argIndex !== 0 && process.argv.length > argIndex) {

			return process.argv[argIndex];
		}
	},
	has: (arg) => {
		return process.argv.indexOf("--" + arg) !== -1
	}
}
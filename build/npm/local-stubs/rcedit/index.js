// Local no-op stub for the 'rcedit' npm package — see package.json for why this exists.
// Only invoked during Windows .exe installer packaging, which this macOS dev build never runs.
'use strict';

function rcedit(_exePath, _options, callback) {
	if (typeof callback === 'function') {
		callback(null);
		return undefined;
	}
	return Promise.resolve();
}

module.exports = rcedit;
module.exports.default = rcedit;

// Local no-op stub for the 'innosetup' npm package — see package.json for why this exists.
// Only its ISCC.exe path is ever consumed, and only during Windows installer packaging,
// which this macOS dev build never runs.
'use strict';

module.exports = {
	ISCC: __filename
};

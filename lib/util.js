(function (root) {
    'use strict';

    module.exports = {
        btoa: root.btoa || function (str) {
            return new Buffer(str).toString('base64');
        },
        isString: function (str) {
            return typeof str == 'string' || str instanceof String;
        },
        isObject: function (o) {
            return typeof o == 'object';
        },
        /**
         *
         * @param {Array} required - List of options that cannot be null/undefined
         * @param {Object} opts - The options to be verified
         * @param {Function} [cb] - Callback to callback with an error.
         * @returns {Array} missingOptions
         */
        assertOptions: function (required, opts, cb) {
            var missing = [];
            required.forEach(function (opt) {
                if (opts[opt] == undefined) missing.push(opt);
            });
            if (missing.length && cb) cb(new CouchError({message: 'Missing options: ' + missing.join(', ')}));
            return missing;
        },
        optsOrCallback: function (optsOrCb, cb) {
            var opts;
            if (optsOrCb instanceof Function) {
                cb = optsOrCb;
                opts = {};
            }
            else {
                opts = optsOrCb;
            }
            return {opts: opts, cb: cb};
        },
        _logError: function (prelude, message) {
            console.error(prelude + ': ' + message);
        },
        /**
         * Log errors to console, depending on the kind of error.
         * @param prelude
         * @param err
         */
        logError: function (prelude, err) {
            if (err) {
                if (err.isCouchError) { // Will have an error code and a human-readable description
                    this._logError(prelude, '(' + err.error + ') ' + err.reason);
                }
                else if (err.isHttpError) { // Dump the status code and the response data.
                    this._logError(prelude, err.status + ': ' + JSON.stringify(err.responseData));
                }
                else if (err.message) { // Custom error with a message
                    this._logError(prelude, err.message);
                }
                else { // This should never happen...
                    console.error("Experienced a CouchError with no discernible meaning... " +
                    "This is a bug in Couch Potato's error handling. Please file a report");
                    this._logError(prelude, 'Unknown');
                }
            }
        },
    };

})(this);
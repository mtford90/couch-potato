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
        }
    };

})(this);
(function () {
    'use strict';

    var merge = require('merge');

    // Imitate PouchError somewhat.
    function CouchPotatoError(extra) {
        merge(this, extra);
        this.keys = ['status', 'name', 'message', 'error', 'ok'].concat(Object.keys(extra));
        this.error = true;
        this.ok = false;
    }

    CouchPotatoError.prototype__proto__ = Error.prototype;

    CouchPotatoError.prototype.toString = function () {
        return JSON.stringify(this.keys.reduce(function (memo, k) {
            var value = this[k];
            if (value != null) memo[k] = value;
            return memo;
        }.bind(this), {}));
    };

    /**
     * @param opts
     * @param [opts.name]
     * @param [opts.message]
     * @param [opts.status] - defaults to 400 (bad request)
     * @returns {CouchPotatoError}
     */
    module.exports = function (opts) {
        opts = opts || {};
        return new CouchPotatoError(merge(opts, {
            status: 400
        }));
    }
})();
(function () {
    'use strict';

    var merge = require('merge'),
        _ = require('nimble'),
        constants = require('./constants'),
        ajax = require('pouchdb').ajax,
        util = require('./util'),
        log = util.logger('potato:http'),
        url = require('url');

    /**
     * Interface to either jquery or node http
     * @param {Auth} auth
     * @param opts
     * @param opts.host
     * @constructor
     */
    function HTTP(auth, opts) {
        var host = opts.url;
        if (host.length) {
            if (host[host.length - 1] == '/') {
                host = host.substring(0, host.length - 1);
            }
        }
        this.host = host.replace('http://', '');
        this.auth = auth;
    }

    HTTP.prototype = {
        /**
         *
         * @param opts
         * @param opts.path
         * @param [opts.protocol]
         * @returns {string}
         * @private
         */
        _constructURL: function (opts) {
            var protocol = opts.protocol || 'http://',
                path = opts.path;
            return protocol + this.host + (path.length ? (path[0] == '/' ? '' : '/') : '') + path;
        },
        /**
         * Send a HTTP request using jquery
         * @param opts - The usual jquery opts +
         * @param opts.path - Path to append to host
         * @param opts.admin - True if endpoint requires admin access
         * @param opts.ignoreAuth
         * @param opts.body
         * @param opts.contentType
         * @param [cb]
         * @private
         */
        _http: function (opts, cb) {
            cb = cb || function () {
                // Do nothing.
            };
            opts = merge({
                method: 'GET'
            }, opts || {});
            if (!opts.ignoreAuth) this.auth.configure(opts);
            var path = opts.path || '';
            if (opts.path != null) delete opts.path;
            if (!opts.url) opts.url = this._constructURL({path: path});
            log('Sending request', opts);
            ajax(opts, cb);
        },

        /**
         * Send a HTTP request or multiple http requests in parallel
         * @param {Object|Array} opts - The usual jquery opts, or an array of them.
         * @param {Object} [opts.path] - Path to append to host
         * @param {Function} [cb]
         */
        http: function (opts, cb) {
            return util.promise(cb, function (cb) {
                if (Array.isArray(opts)) {
                    _.parallel(opts.map(function (_opts) {
                        return function (done) {
                            this._http(_opts, done);
                        }.bind(this)
                    }.bind(this)), cb);
                }
                else {
                    this._http(opts, cb);
                }
            }.bind(this));
        }
    };

    module.exports = function (auth, opts) {
        return new HTTP(auth, opts);
    };

})();
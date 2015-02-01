/**
 * Couch Potato command-line tools.
 * @module tools
 */
(function () {
    'use strict';

    var sofaUtil = require('./util'),
        util = require('../lib/util'),
        async = require('async'),
        potato = require('../potato'),
        merge = require('merge');

    /**
     * Merges provided options with default options.
     * @param {Object} opts
     */
    function getOpts(opts) {
        return merge({
            cleanUp: false
        }, opts);
    }

    /**
     *
     * @param opts
     * @param [opts.cleanUp] - Whether or not to remove design docs that are no longer present in the config file. Defaults to false
     *
     */
    module.exports = function (opts) {
        opts = getOpts(opts);
        return {
            /**
             * Load and verify a couch potato config file (which is just a javascript module that follows a
             * particular structure)
             * @param {String|Object} pathOrConfig
             * @returns {*}
             */
            loadConfig: function (pathOrConfig) {
                var config;
                if (util.isString(pathOrConfig)) {
                    config = require(pathOrConfig);
                }
                else config = pathOrConfig;
                this.verifyConfig(config);
                return config;
            },
            /**
             * Throws an error if invalid couch potato config is detected.
             * @param {Object} config
             */
            verifyConfig: function (config) {

            },
            __logError: function (prelude, message) {
                console.error(prelude + ': ' + message);
            },
            /**
             * Log errors to console, depending on the kind of error.
             * @param prelude
             * @param err
             * @private
             */
            _logError: function (prelude, err) {
                if (err) {
                    if (err.isCouchError) {
                        this.__logError(prelude, '(' + err.error + ') ' + err.reason);
                    }
                    else if (err.isHttpError) {
                        this.__logError(prelude, err.status + ': ' + JSON.stringify(err.responseData));
                    }
                    else {
                        this.__logError(prelude, err.message);
                    }
                }
            }, /**
             *
             * @param {Object} databases
             * @param {Function} [cb]
             */
            configureDatabases: function (databases, cb) {
                cb = cb || function () {
                };
                var tasks = Object.keys(databases).map(function (dbName) {
                    var dbConfig = databases[dbName];
                    var couch = potato.couchdb();
                    return function (done) {
                        couch.createOrUpdateDatabase(merge({database: dbName}, dbConfig), function (err) {
                            if (err) this._logError('Error creating database "' + dbName + '"', err);
                            done(err);
                        }.bind(this));
                    }.bind(this);
                }.bind(this));
                async.parallel(tasks, cb);
            },
            /**
             * Given a couch potato configuration object, configures CouchDB accordingly.
             * @param {Object} config
             * @param {Function} [cb]
             */
            configureCouch: function (config, cb) {
                cb = cb || function () {
                };
                var databases = config.databases || {};
                this.configureDatabases(databases, cb);
            }
        }
    }
})();
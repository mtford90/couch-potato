/**
 * Couch Potato command-line tools.
 * @module tools
 */
(function () {
    'use strict';

    var toolsUtil = require('./util'),
        util = require('../lib/util'),
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
            /**
             * Given a couch potato configuration file, configures CouchDB accordingly.
             * @param {Object} config
             */
            configureCouch: function (config) {

            }
        }
    }
})();
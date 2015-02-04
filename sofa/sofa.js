/**
 * Couch Potato command-line tools.
 * @module tools
 */
(function () {
    'use strict';

    var sofaUtil = require('./util'),
        util = require('../lib/util'),
        async = require('async'),
        Potato = require('../potato'),
        path = require('path'),
        winston = require('winston'),
        merge = require('merge');

    module.exports = {
        /**
         * Load and verify a couch potato config file (which is just a javascript module that follows a
         * particular structure)
         * @param {String|Object} pathOrConfig
         * @returns {*}
         */
        loadConfig: function (pathOrConfig) {
            var config;
            if (util.isString(pathOrConfig)) {
                var splt = pathOrConfig.split('.');
                if (splt[splt.length - 1] == 'js') pathOrConfig = pathOrConfig.slice(0, pathOrConfig.length - 3);
                console.log('path', pathOrConfig);
                var resolvedPath = path.resolve(pathOrConfig);
                console.log('resolvedPath', resolvedPath);
                config = require(resolvedPath);
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
         *
         * @param {Object} databases
         * @param {Function} [cb]
         */
        configureDatabases: function (databases, cb) {
            cb = cb || function () {
            };
            var tasks = Object.keys(databases).map(function (dbName) {
                var dbConfig = databases[dbName];
                var potato = new Potato();
                return function (done) {
                    winston.info('Creating ' + dbName);
                    potato.getOrCreateDatabase(dbName, dbConfig, done);
                }.bind(this);
            }.bind(this));
            async.parallel(tasks, cb);
        },
        /**
         * Given a couch potato configuration object, configures CouchDB accordingly.
         * @param {Object|String|string} config
         * @param {Function} [cb]
         */
        configureCouch: function (config, cb) {
            config = this.loadConfig(config);
            console.log('config', config);
            cb = cb || function () {
            };
            var databases = config.databases || {};
            this.configureDatabases(databases, cb);
        }
    }
})();
(function (root) {
    'use strict';

    var merge = require('merge'),
        util = require('./util'),
        CouchError = require('./CouchError'),
        constants = require('./constants'),
        EventEmitter = require('events').EventEmitter;

    /**
     * This is used in construction of the API object.
     * It pulls public functions from each module and places them on the API object.
     * @param api - The object we're extending
     * @param mod - The module from which we will pull functions.
     */
    function extendAPI(api, mod) {
        for (var funcName in mod) {
            var isPublicFunction = funcName[0] != '_';
            if (isPublicFunction) {
                var func = mod[funcName];
                if (func instanceof Function) {
                    if (!api[funcName]) {
                        api[funcName] = func.bind(mod);
                    }
                    else {
                        throw new Error(funcName + ' already exists on the API object.');
                    }
                }
            }
        }
    }

    var apiFactory = function (opts) {
        opts = opts || {};
        opts.database = opts.database || 'db';

        /**
         * Public API
         * @extends EventEmitter
         * @constructor
         */
        function API(opts) {
            EventEmitter.call(this, opts);
            merge(this, constants);

        }

        API.prototype = Object.create(EventEmitter.prototype);

        merge(API.prototype, {
            /**
             * Clear out the database. Useful during testing.
             * @param [optsOrCb]
             * @param [optsOrCb.username] - admin username
             * @param [optsOrCb.password] - admin password
             * @param cb
             */
            reset: function (optsOrCb, cb) {
                var __ret = util.optsOrCallback(optsOrCb, cb),
                    opts = __ret.opts;
                cb = __ret.cb;
                this.deleteAllDatabases(opts, function (err) {
                    if (!err) this.logout();
                    cb(err);
                }.bind(this));
            }
        });

        // Configure dependencies between the different couchdb APIs.
        var api = new API(),
            auth = require('./auth')(api, opts),
            http = require('./http')(auth, opts),
            users = require('./users')(auth, http),
            admin = require('./admin')(auth, http, opts),
            documents = require('./documents')(auth, http, opts),
            attachments = require('./attachments')(auth, http, opts);

        // Make available auth info on the api object.
        Object.defineProperty(api, 'auth', {
            get: function () {
                return auth.auth;
            },
            set: function (_auth) {
                auth.setAuth(_auth);
            }
        });

        [auth, users, admin, attachments, documents].forEach(function (mod) {
            extendAPI(api, mod);
        });

        return api;
    };

    for (var prop in constants) {
        if (constants.hasOwnProperty(prop)) apiFactory[prop] = constants[prop];
    }

    apiFactory.CouchError = CouchError;
    root.couchdb = apiFactory;
    // Place on window object if in browser environment.
    var isBrowser = !!global.XMLHttpRequest;
    if (isBrowser) global.couchdb = apiFactory;
})(this);
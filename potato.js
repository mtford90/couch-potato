/**
 * CouchDB API - works in both browser and node environments.
 */
(function (root) {
    'use strict';

    var merge = require('merge'),
        util = require('./lib/util'),
        CouchError = require('./lib/CouchError'),
        constants = require('./lib/constants'),
        _ = require('nimble'),
        PouchDB = require('pouchdb'),
        getArguments = require('argsarray'),
        ajax = PouchDB.ajax,
        url = require('url'),
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


    /**
     * Returns an API to an instance of CouchDB,
     * @param [opts]
     * @param [opts.protocol] - defaults to http
     * @param [opts.host] - defaults to localhost
     * @param [opts.port] - defaults to 5984
     * @param [opts.auth] - custom auth
     */
    var potato = function (opts) {
        opts = opts || {};
        if (opts.port) opts.port = opts.port.toString();

        opts = merge({
            host: 'localhost',
            port: '5984',
            protocol: 'http'
        }, opts);
        opts.url = opts.protocol + '://' + opts.host + ':' + opts.port;

        /**
         * The couch potato API
         * @constructor
         */
        function CouchPotatoAPI() {
            EventEmitter.call(this);
        }

        CouchPotatoAPI.prototype = Object.create(EventEmitter.prototype);

        var api = new CouchPotatoAPI(),
            auth = require('./lib/auth')(api, opts),
            http = require('./lib/http')(auth, opts),
            users = require('./lib/users')(auth, http);


        function CouchPotatoDB(database) {
            var dbOpts = merge({path: database, database: database || 'db'}, opts);
            dbOpts.url = dbOpts.protocol + '://' + dbOpts.host + ':' + dbOpts.port + '/' + dbOpts.database;
            PouchDB.call(this, dbOpts.url, dbOpts);
            merge(this, constants);
            this.opts = dbOpts;
            this.http = http;
            this.auth = auth;
        }

        CouchPotatoDB.prototype = Object.create(PouchDB.prototype);

        merge(CouchPotatoDB.prototype, require('./lib/admin'));

        function gatherArguments(args) {
            var doc, opts, cb, argsArray = [];
            for (var i = 0; i < args.length; i++) {
                var arg = args[i];
                if (i == 0 && util.isObject(arg)) doc = arg;
                else if (util.isObject(arg)) {
                    opts = arg;
                }
                else if (arg instanceof Function) cb = arg;
                argsArray.push(arg)
            }
            return {
                doc: doc,
                opts: opts,
                cb: cb,
                _: argsArray
            };
        }

        function injectAuthIntoArgs(_args) {
            var argObj = gatherArguments(_args),
                args = argObj._;
            console.log('argObj', argObj);
            var opts;
            if (argObj.opts) {
                opts = argObj.opts;
            }
            else if (args.length && args[args.length - 1] instanceof Function) {
                opts = {};
                args.splice(args.length - 1, 0, opts)
            }
            else {
                opts = {};
                args.push(opts);
            }
            var ajax;
            if (!opts.ajax) opts.ajax = {};
            ajax = opts.ajax;
            http._configureAuth(ajax);
            return argObj;
        }

        merge(CouchPotatoAPI.prototype, {
            Database: CouchPotatoDB,
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
                _.series([
                    this.deleteAllDatabases.bind(this, opts),
                    this.deleteAllUsers.bind(this)
                ], function (err) {
                    if (!err) this.logout();
                    else {
                        util.logError('Error resetting db', err);
                    }
                    cb(err);
                }.bind(this));
            },
            /**
             * @param name
             * @param [opts]
             * @param [opts.anonymousUpdates]
             * @param [opts.anonymousReads]
             * @param [opts.designDocs]
             * @param [cb]
             */
            database: function (name, opts, cb) {
                var __ret = util.optsOrCallback(opts, cb);
                opts = merge({}, __ret.opts);
                cb = __ret.cb;
                opts.path = name;
                opts.type = 'PUT';
                opts.admin = true;
                // Create database
                http.json(opts, function (err, data) {
                    if (!err) {
                        var db = new CouchPotatoDB(name);
                        var oldPut = db.put,
                            oldPost = db.post,
                            oldGet = db.get;
                        merge(db, {
                            put: getArguments(function (args) {
                                var argsobj = injectAuthIntoArgs(args);
                                args = argsobj._;
                                if ('user' in argsobj.doc) {
                                    var cb = argsobj.cb || function () {};
                                    cb(new CouchError({message: 'User arg not allowed'}));
                                    return;
                                }
                                console.log('put args', args);
                                oldPut.apply(db, args);
                            }),
                            get: getArguments(function (args) {
                                var argsobj = injectAuthIntoArgs(args);
                                args = argsobj._;
                                console.log('get args', args);
                                oldGet.apply(db, args);
                            })
                        });
                        db.configureDatabase(opts, function (err) {
                            if (!err) {
                                cb(null, db);
                            } else cb(err);
                        });
                    } else cb(err, data);
                }.bind(this));
            },
            /**
             * Clear out the database. Useful during testing.
             * @param [opts]
             * @param cb
             */
            deleteAllDatabases: function (opts, cb) {
                var __ret = util.optsOrCallback(opts, cb);
                opts = __ret.opts;
                cb = __ret.cb;
                opts.path = '_all_dbs';
                opts.admin = true;
                http.json(opts, function (err, data) {
                    if (err) cb(err);
                    else {
                        var ajaxOpts = data.reduce(function (memo, dbName) {
                            if (!constants.IGNORE_DATABASES.memberOf(dbName)) {
                                memo.push({
                                    type: 'DELETE',
                                    path: dbName,
                                    admin: true
                                });
                            }
                            return memo;
                        }, []);
                        http.json(ajaxOpts, cb);
                    }
                }.bind(this));
            },
            /**
             * Delete all users in the database (excluding admin users)
             * @param cb
             */
            deleteAllUsers: function (cb) {
                cb = cb || function () {
                };
                http.json({
                    path: '_users/_all_docs',
                    admin: true
                }, function (err, resp) {
                    if (!err) {
                        var userDocs = resp.rows.reduce(function (memo, data) {
                            if (data.id.indexOf('org.couchdb.user') > -1) {
                                memo.push({
                                    _id: data.id,
                                    _rev: data.value.rev,
                                    _deleted: true
                                })
                            }
                            return memo;
                        }, []);
                        http.json({
                            path: '_users/_bulk_docs',
                            data: {docs: userDocs},
                            admin: true,
                            type: 'POST'
                        }, function (err) {
                            if (err) util.logError('Error deleting all users', err);
                            cb(err);
                        });
                    } else {
                        util.logError('Error getting all users', err);
                        cb(err);
                    }
                }.bind(this));
            }
        });

        [auth, users].forEach(function (mod) {
            extendAPI(api, mod);
        });

        // Make available auth info on the api object.
        Object.defineProperty(api, 'auth', {
            get: function () {
                return auth.auth;
            },
            set: function (_auth) {
                auth.setAuth(_auth);
            }
        });

        for (var prop in constants) {
            if (constants.hasOwnProperty(prop)) api[prop] = constants[prop];
        }

        return api;
    };

    for (var prop in constants) {
        if (constants.hasOwnProperty(prop)) potato[prop] = constants[prop];
    }

    potato.CouchError = CouchError;
    root.potato = potato;
    // Place on window object if in browser environment.
    var isBrowser = !!global.XMLHttpRequest;
    if (isBrowser) global.potato = potato;

})(this);
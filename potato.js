/**
 * CouchDB API - works in both browser and node environments.
 */
(function () {
    'use strict';

    var merge = require('merge'),
        util = require('./lib/util'),
        constants = require('./lib/constants'),
        _ = require('nimble'),
        PouchDB = require('pouchdb'),
        getArguments = require('argsarray'),
        url = require('url'),
        EventEmitter = require('events').EventEmitter;

    util._patchBind();


    /**
     * @param opts
     * @param opts.database
     * @param opts.http
     * @param opts.auth
     * @param opts.potato
     * @constructor
     */
    function CouchPotatoDB(opts) {
        var database = opts.database,
            potatoOpts = opts.potato.opts;
        var dbOpts = merge({path: database, database: database || 'db'}, potatoOpts);
        dbOpts.url = dbOpts.protocol + '://' + dbOpts.host + ':' + dbOpts.port + '/' + dbOpts.database;
        PouchDB.call(this, dbOpts.url, dbOpts);
        merge(this, constants);
        this.opts = dbOpts;
        this.http = opts.http;
        this.auth = opts.auth;
    }

    CouchPotatoDB.prototype = Object.create(PouchDB.prototype);

    merge(CouchPotatoDB.prototype, require('./lib/admin'));

    /**
     * Returns an API to an instance of CouchDB,
     * @param [opts]
     * @param [opts.protocol] - defaults to http
     * @param [opts.host] - defaults to localhost
     * @param [opts.port] - defaults to 5984
     * @param [opts.auth] - custom auth
     * @constructor
     */
    function Potato(opts) {
        opts = opts || {};
        if (opts.port) opts.port = opts.port.toString();

        opts = merge({
            host: 'localhost',
            port: '5984',
            protocol: 'http'
        }, opts);
        opts.url = opts.protocol + '://' + opts.host + ':' + opts.port;
        EventEmitter.call(this);

        this.opts = opts;

        var auth = require('./lib/auth')(this, opts),
            http = require('./lib/http')(auth, opts),
            ajax = http.http.bind(http),
            users = require('./lib/users')(auth, ajax);

        this.auth = auth;
        this.http = ajax;
        this.accounts = this.users = this.account = users;

        for (var prop in constants) {
            if (constants.hasOwnProperty(prop)) this[prop] = constants[prop];
        }

    }

    Potato.prototype = Object.create(EventEmitter.prototype);

    merge(Potato.prototype, {
        Database: CouchPotatoDB,
        /**
         * Clear out the database. Useful during testing.
         * @param [opts]
         * @param [opts.username] - admin username
         * @param [opts.password] - admin password
         * @param cb
         */
        reset: util.optsOrCb(function (args) {
            return util.promise(args.cb, function (cb) {
                _.series([
                    // Ensure that there are no session keys to screw up admin basic auth...
                    this.accounts.logout.bind(this.accounts),
                    this.deleteAllDatabases.bind(this, args.opts),
                    this.deleteUserDatabase.bind(this)
                ], cb);
            }.bind(this));
        }),
        _gatherArguments: function (args) {
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
        },

        /**
         * Searches out or creates the PouchDB options object and ensures that the right authorisation headers are set!
         * @param _args
         * @returns {*}
         * @private
         */
        _injectAuthIntoArgs: function (_args) {
            var argObj = this._gatherArguments(_args),
                args = argObj._;
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
            this.auth.configure(ajax);
            return argObj;
        },

        _pouchDB: function (name) {
            var db = new CouchPotatoDB({
                database: name,
                auth: this.auth,
                http: this.http,
                potato: this
            });
            var oldPut = db.put,
                oldGet = db.get;
            merge(db, {
                put: getArguments(function (args) {
                    var argsobj = this._injectAuthIntoArgs(args);
                    args = argsobj._;
                    if ('user' in argsobj.doc) {
                        var cb = argsobj.cb || function () {
                            };
                        cb(util.error({message: 'User arg not allowed'}));
                        return;
                    }
                    console.log('put args', args);
                    oldPut.apply(db, args);
                }.bind(this)),
                get: getArguments(function (args) {
                    var argsobj = this._injectAuthIntoArgs(args);
                    args = argsobj._;
                    console.log('get args', args);
                    oldGet.apply(db, args);
                }.bind(this))
            });
            return db;
        },

        /**
         * @param name
         * @param {Object|Function} [opts]
         * @param [opts.anonymousUpdates]
         * @param [opts.anonymousReads]
         * @param [opts.designDocs]
         * @param [cb]
         */
        getOrCreateDatabase: function (name, opts, cb) {
            if (opts instanceof Function) {
                cb = opts;
                opts = undefined;
            }
            opts = opts || {};
            opts.path = name;
            opts.method = 'PUT';
            opts.admin = true;
            return util.promise(cb, function (cb) {
                // Create database
                this.http(opts, function (err, data) {
                    if (!err) {
                        var db = this._pouchDB(name);
                        db.configureDatabase(opts, function (err) {
                            if (!err) {
                                cb(null, db);
                            } else cb(err);
                        });
                    } else cb(err, data);
                }.bind(this));
            }.bind(this));
        },

        getDatabase: function (name, cb) {
            return util.promise(cb, function (cb) {
                this.http({
                    path: name,
                    admin: true
                }, function (err) {
                    if (!err) {
                        var db = this._pouchDB(name);
                        cb(null, db);
                    } else cb(err);
                }.bind(this));
            }.bind(this));
        },
        /**
         * Clear out the database. Useful during testing.
         * @param [opts]
         * @param cb
         */
        deleteAllDatabases: util.optsOrCb(function (args) {
            var opts = args.opts,
                cb = args.cb;
            opts.path = '_all_dbs';
            opts.admin = true;
            return util.promise(cb, function (cb) {
                this.http(opts, function (err, data) {
                    if (err) cb(err);
                    else {
                        var ajaxOpts = data.reduce(function (memo, dbName) {
                            if (!constants.IGNORE_DATABASES.memberOf(dbName)) {
                                memo.push({
                                    method: 'DELETE',
                                    path: dbName,
                                    admin: true
                                });
                            }
                            return memo;
                        }, []);
                        this.http(ajaxOpts, cb);
                    }
                }.bind(this));
            }.bind(this));
        }),
        /**
         * Delete all users in the database (excluding admin users)
         * @param cb
         */
        deleteAllUsers: function (cb) {
            var log = util.logger('potato:core');
            log('deleting all users');
            return util.promise(cb, function (cb) {
                this.http({
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
                        if (userDocs.length) {
                            this.http({
                                path: '_users/_bulk_docs',
                                body: {docs: userDocs},
                                admin: true,
                                method: 'POST'
                            }, function (err) {
                                if (err) util.logError('Error deleting all users', err);
                                cb(err);
                            });
                        }
                        else {
                            cb();
                        }
                    } else {
                        util.logError('Error getting all users', err);
                        cb(err);
                    }
                }.bind(this));
            }.bind(this));
        },
        deleteUserDatabase: function (cb) {
            return util.promise(cb, function (cb) {
                this.http({
                    path: '_users',
                    method: 'DELETE',
                    admin:  true
                }, cb);
            }.bind(this));
        }
    });

    for (var prop in constants) {
        if (constants.hasOwnProperty(prop)) Potato[prop] = constants[prop];
    }

    // Place on window object if in browser environment.
    var isBrowser = !!global.XMLHttpRequest;
    if (isBrowser) global.Potato = Potato;
    Potato.debug = require('debug');
    Potato.debug.enable('*');
    module.exports = Potato;

})();
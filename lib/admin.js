/**
 * Make available CouchDB admin facilities as well as various convienience stuff.
 * @module admin
 */
(function (root) {
    'use strict';

    var util = require('./util'),
        constants = require('./constants'),
        merge = require('merge'),
        _ = require('nimble');

    function Admin(auth, http, opts) {
        this.auth = auth;
        this.http = http;
        this.opts = opts;
    }

    Admin.prototype = {
        /**
         * Clear out the database. Useful during testing.
         * @param [optsOrCb]
         * @param cb
         */
        deleteAllDatabases: function (optsOrCb, cb) {
            var __ret = util.optsOrCallback(optsOrCb, cb),
                opts = __ret.opts;
            cb = __ret.cb;
            opts.path = '_all_dbs';
            opts.admin = true;
            this.http.json(opts, function (err, data) {
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
                    this.http.json(ajaxOpts, cb);
                }
            }.bind(this));
        },
        /**
         *
         * @param doc
         * @param opts
         * @param opts.id
         * @param [opts.remove]
         * @param [opts.admin]
         * @param [opts.database]
         * @param cb
         * @private
         */
        _toggleDoc: function (doc, opts, cb) {
            var database = opts.database || this.opts.database,
                id = opts.id,
                remove = opts.remove;
            var path = database + '/' + id;
            this.http.json(merge(true, opts, {
                path: path,
                admin: opts.admin
            }), function (err, resp) {
                var found = true;
                if (err) {
                    if (err.status == constants.HTTP_STATUS.NOT_FOUND) found = false;
                    else {
                        cb(err);
                        return;
                    }
                }
                if (remove && found) {
                    // delete it
                    path += '?rev=' + resp._rev;
                    this.http.json(merge(true, opts, {
                        type: 'DELETE',
                        path: path,
                        admin: opts.admin
                    }), cb);
                }
                else if (!remove) {
                    // create or update it
                    if (found) doc._rev = resp._rev;
                    this.http.json(merge(true, opts, {
                        type: 'PUT',
                        path: path,
                        data: doc,
                        admin: opts.admin
                    }), cb);
                }
                else {
                    // Nothing to do!
                    cb(null, resp);
                }
            }.bind(this))
        },
        /**
         *
         * @param [opts]
         * @param [opts.anonymousUpdates]
         * @param [opts.anonymousReads]
         * @param [cb]
         */
        configureDatabase: function (opts, cb) {
            var tasks = [];
            if (opts.anonymousUpdates != undefined) {
                tasks.push(function (done) {
                    var doc = {
                        language: 'javascript',
                        validate_doc_update: function (new_doc, old_doc, userCtx) {
                            if (!userCtx.name) {
                                throw({forbidden: "Not Authorized"});
                            }
                        }.toString()
                    };
                    this._toggleDoc(doc, {
                        id: '_design/blockAnonymousUpdates',
                        remove: opts.anonymousUpdates,
                        admin: true
                    }, done);
                }.bind(this));
            }
            if (opts.anonymousReads != undefined) {
                tasks.push(function (done) {
                    var doc = {
                        language: 'javascript',
                        validate_doc_read: function (doc, userCtx) {
                            if (!userCtx.name) {
                                throw({forbidden: "Not Authorized"});
                            }
                        }.toString()
                    };
                    this._toggleDoc(doc, {
                        id: '_design/blockAnonymousReads',
                        remove: opts.anonymousReads,
                        admin: true
                    }, done);
                }.bind(this));
            }
            _.parallel(tasks, cb);
        },

        /**
         *
         * @param [optsOrCb]
         * @param [optsOrCb.database]
         * @param [optsOrCb.anonymousUpdates]
         * @param [optsOrCb.anonymousReads]
         * @param [cb]
         */
        createDatabase: function (optsOrCb, cb) {
            var __ret = util.optsOrCallback(optsOrCb, cb);
            var opts = __ret.opts;
            cb = __ret.cb;
            opts.path = opts.database || this.opts.database;
            opts.type = 'PUT';
            opts.admin = true;
            this.http.json(opts, function (err) {
                if (!err) {
                    this.configureDatabase(opts, cb);
                } else cb(err);
            }.bind(this));
        },

        /**
         * @param [optsOrCb]
         * @param [optsOrCb.database]
         * @param [cb]
         */
        getPermissions: function (optsOrCb, cb) {
            var __ret = util.optsOrCallback(optsOrCb, cb);
            var opts = __ret.opts;
            cb = __ret.cb;
            var database = opts.database || this.opts.database;
            opts.path = database + '/_security';
            opts.admin = true;
            this.http.json(opts, cb);
        },
        /**
         * Verify that the configuration is ok.
         * @param cb
         */
        verify: function (cb) {
            this.http.json({
                path: this.opts.database
            }, cb);
        },
        info: function (cb) {
            this.http.json({path: ''}, cb);
        }
    };

    module.exports = function (auth, http, opts) {
        return new Admin(auth, http, opts);
    };
})(this);
/**
 * Make available CouchDB admin facilities as well as various convienience stuff.
 * @module admin
 */
(function () {
    'use strict';

    var util = require('./util'),
        constants = require('./constants'),
        merge = require('merge'),
        _ = require('nimble');

    module.exports = {
        /**
         *
         * @param doc
         * @param opts
         * @param opts.id
         * @param [opts.remove]
         * @param [opts.admin]
         * @param cb
         * @private
         */
        _toggleDoc: function (doc, opts, cb) {
            var database = this.opts.database,
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
         * Update a database.
         * @param [opts]
         * @param [opts.anonymousUpdates]
         * @param [opts.anonymousReads]
         * @param [opts.designDocs]
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
            var designDocs = opts.designDocs || {};
            tasks = tasks.concat(Object.keys(designDocs).map(function (name) {
                return function (done) {
                    this.createOrUpdateDesignDocument({
                        name: name,
                        doc: designDocs[name],
                        database: opts.database
                    }, done);
                }.bind(this);
            }.bind(this)));
            _.parallel(tasks, cb);
        },


        /**
         * @param [optsOrCb]
         * @param [cb]
         */
        getPermissions: function (optsOrCb, cb) {
            var __ret = util.optsOrCallback(optsOrCb, cb);
            var opts = __ret.opts;
            cb = __ret.cb;
            var database = this.opts.database;
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

        /**
         *
         * @param opts
         * @param opts.name
         * @param opts.doc
         * @param [opts.database]
         * @param cb
         */
        createOrUpdateDesignDocument: function (opts, cb) {
            var __ret = util.optsOrCallback(opts, cb);
            opts = __ret.opts;
            cb = __ret.cb;
            this.getDesignDocument(opts, function (err, doc) {
                if (err) {
                    if (err.status == 404) {
                        this.createDesignDocument(opts, cb);
                    } else cb(err);
                } else this.updateDesignDocument(opts, cb)
            }.bind(this));
        },

        /**
         *
         * @param opts
         * @param opts.name
         * @param opts.doc
         * @param cb
         */
        updateDesignDocument: function (opts, cb) {
            var __ret = util.optsOrCallback(opts, cb);
            opts = __ret.opts;
            cb = __ret.cb;
            var newDoc = merge({}, opts.doc);
            delete newDoc._rev;
            this.getDesignDocument(opts, function (err, doc) {
                if (!err) {
                    this.http.json({
                        path: this._constructDesignDocPath(this.opts.database, opts.name),
                        data: merge(newDoc, doc),
                        admin: true
                    })
                } else cb(err);
            }.bind(this));
        },

        /**
         * Convert design doc into format recognised by CouchDB's REST API.
         * @param doc
         * @param name
         * @returns {*}
         * @private
         */
        _constructDesignDocData: function (doc, name) {
            var data = merge({}, doc);
            // _designdoc id convention
            data._id = '_design/' + name;
            var views = data.views || {};
            Object.keys(views).forEach(function (viewName) {
                var view = views[viewName];
                if (view.map) view.map = view.map.toString();
                if (view.reduce) view.reduce = view.reduce.toString();
            });
            return data;
        },

        /**
         * Create a new design document
         * @param opts
         * @param opts.name
         * @param opts.doc
         * @param [opts.database]
         * @param cb
         */
        createDesignDocument: function (opts, cb) {
            var __ret = util.optsOrCallback(opts, cb);
            opts = __ret.opts;
            cb = __ret.cb;
            var database = this.opts.database;
            var name = opts.name;
            var path = this._constructDesignDocPath(database, name);
            var doc = opts.doc;
            var data = this._constructDesignDocData(doc, name);
            this.http.json({
                path: path,
                type: 'PUT',
                data: data,
                admin: true
            }, cb);
        },

        /**
         * Construct the URL path for a design doc with given name
         * @param name - design doc name
         * @returns {string}
         * @private
         */
        _constructDesignDocPath: function (database, name) {
            return this.opts.database + '/_design/' + name;
        },

        /**
         * @param opts
         * @param opts.name
         * @param cb
         */
        getDesignDocument: function (opts, cb) {
            var __ret = util.optsOrCallback(opts, cb);
            opts = __ret.opts;
            cb = __ret.cb;
            var name = opts.name;
            var database = this.opts.database,
                path = this._constructDesignDocPath(database, name);
            this.http.json({
                path: path,
                admin: true
            }, cb)
        }
    };

})();
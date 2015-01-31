/**
 * Documents API
 */
(function (root) {
    'use strict';

    var constants = require('./constants'),
        CouchError = require('./CouchError'),
        util = require('./util'),
        merge = require('merge');

    function Documents(auth, http, opts) {
        this.auth = auth;
        this.http = http;
        this.opts = opts;
    }

    Documents.prototype = {
        _upsertDocumentArguments: function (args) {
            var doc, opts, cb;
            if (util.isObject(args[0]) && util.isObject(args[1])) {
                doc = args[0];
                opts = args[1];
                cb = args[2];
            }
            else if (util.isObject(args[0])) {
                doc = args[0];
                opts = {};
                cb = args[1];
            }
            else {
                doc = {};
                opts = {};
                cb = args[0];
            }
            cb = cb || function () {
            };
            return {doc: doc, opts: opts, cb: cb};
        },

        /**
         * Updates special fields in the couchdb doc given a response from couchdb.
         * @param doc
         * @param resp
         * @private
         * @returns {string|undefined} - validation error if appropriate
         */
        _updateDocWithResponse: function (doc, resp) {
            var newid = resp.id,
                newrev = resp.rev;
            if (!newid) return 'No id in response';
            if (!newrev) return 'No rev in response';
            doc._id = newid;
            doc._rev = newrev;
        },

        /**
         * Creates or updates a document. Uses PUT/POST appropriately.
         * @param [doc]
         * @param [opts]
         * @param [opts.merge] - If revision doesn't match, automatically merge the document.
         * @param [cb]
         */
        upsertDocument: function () {
            var args = this._upsertDocumentArguments(arguments),
                doc = args.doc,
                opts = args.opts,
                cb = args.cb,
                id, path;
            if (doc._id) {
                id = doc._id;
            }
            path = opts.db || this.opts.database;
            if (id) path += '/' + id;
            var auth = this.auth.auth;
            if (auth) {
                if ('user' in doc) {
                    cb(new CouchError({message: 'the user field is reserved'}));
                    return;
                }
                doc.user = auth.user.name;
            }
            this.http.json({
                path: path,
                data: doc,
                type: id ? 'PUT' : 'POST'
            }, function (err, resp) {
                if (!err) {
                    var processedDoc = merge({}, doc);
                    err = this._updateDocWithResponse(processedDoc, resp);
                    cb(err, processedDoc, resp);
                }
                else {
                    var isConflict = err.status == constants.HTTP_STATUS.CONFLICT,
                        shouldMerge = opts.conflicts == 'merge';
                    if (shouldMerge && isConflict) {
                        this._merge(doc, opts, cb);
                    }
                    else {
                        cb(err);
                    }
                }
            }.bind(this));
        },
        /**
         * Will repeatedly hit CouchDB until doc has been merged (e.g. no conflict)
         * @param doc
         * @param opts
         * @param cb
         * @private
         */
        _merge: function (doc, opts, cb) {
            this.getDocument(doc._id, opts, function (err, resp) {
                if (!err) {
                    delete doc._rev;
                    doc = merge(resp, doc);
                    // Try again now that _rev should be updated.
                    this.upsertDocument(doc, opts, cb);
                } else cb(err);
            }.bind(this));
        },
        /**
         * Get document with id
         * @param _id
         * @param [optsOrCb]
         * @param [optsOrCb.database]
         * @param [cb]
         */
        getDocument: function (_id, optsOrCb, cb) {
            var __ret = util.optsOrCallback(optsOrCb, cb),
                opts = __ret.opts;
            cb = __ret.cb;
            var database = opts.database || this.opts.database;
            this.http.json({
                path: database + '/' + _id
            }, cb);
        }


    };

    module.exports = function (auth, http, opts) {
        return new Documents(auth, http, opts);
    };
})(this);
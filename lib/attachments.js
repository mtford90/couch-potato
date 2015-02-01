/**
 * Attachments API.
 */
(function (root) {
    'use strict';

    var util = require('./util'),
        CouchError = require('./CouchError');

    function Attachments(auth, http, opts) {
        this.auth = auth;
        this.http = http;
        this.opts = opts;
    }

    Attachments.prototype = {

        /**
         *
         * @param opts
         * @param opts.doc - a document with _id or an string representation of _id
         * @param opts.attName - name of the attachment
         * @param [cb]
         */
        getAttachment: function (opts, cb) {
            var database = opts.db || this.opts.database,
                id = util.isString(opts.doc) ? opts.doc : opts.doc._id,
                path = database + '/' + id + '/' + opts.attName;
            this.http.http({
                path: path,
                contentType: null
            }, cb);
        },

        /**
         *
         * @param opts
         * @param opts.doc - a document with _id or an string representation of _id
         * @param opts.attName - name of the attachment
         * @param [opts.db]
         * @param [opts.data] - raw bytes to push
         * @param [opts.url] - ajax options to get data
         * @param [opts.mimeType] - required if use data parameter
         * @param [cb]
         */
        putAttachment: function (opts, cb) {
            cb = cb || function () {
            };
            if (opts.data) {
                if (util.assertOptions(['data', 'mimeType', 'attName', 'doc'], opts, cb).length) return;
                var database = opts.db || this.opts.database,
                    id = util.isString(opts.doc) ? opts.doc : opts.doc._id,
                    mimeType = opts.mimeType || false,
                    rev = opts.doc._rev,
                    path = database + '/' + id + '/' + opts.attName;
                if (rev) path += '?rev=' + rev;
                var headers = opts.headers || {};
                //headers['Content-Type'] = mimeType;
                var httpOpts = {
                    path: path,
                    type: 'PUT',
                    data: opts.data,
                    cache: false,
                    processData: false,
                    contentType: mimeType
                };
                httpOpts.headers = headers;
                this.http.http(httpOpts, cb);
            }
            else if (opts.url) {
                if (util.assertOptions(['url', 'attName', 'doc'], opts, cb).length) return;
                /*
                 jquery ajax does not support blobs
                 http://stackoverflow.com/questions/17657184/using-jquerys-ajax-method-to-retrieve-images-as-a-blob
                 even if not using blob kept experiencing issues with corruption of image data.
                 It's probably something to do with encoding but will XHR for this for now.
                 TODO: Use jquery instead for the below (if possible)
                 */
                this.http.xhrHttp({
                    method: 'GET',
                    url: opts.url,
                    responseType: 'blob'
                }, function (err, data) {
                    if (!err) {
                        var database = opts.db || this.opts.database,
                            id = util.isString(opts.doc) ? opts.doc : opts.doc._id,
                            rev = opts.doc._rev,
                            mimeType = opts.mimeType || false,
                            path = database + '/' + id + '/' + opts.attName;
                        if (rev) path += '?rev=' + rev;
                        this.http.http({
                            path: path,
                            type: 'PUT',
                            data: data,
                            processData: false,
                            contentType: mimeType
                        }, cb);
                    }
                    else {
                        util.logError('Error putting attachment', err);
                        cb(err);
                    }
                }.bind(this));
            }
            else {
                cb(new CouchError({message: 'Must specify either data or ajax'}));
            }
        },

        /**
         *
         * @param opts
         * @param opts.data
         * @param opts.mimeType,
         * @param opts.attName
         * @param cb
         */
        constructAttachmentFromRawData: function (opts, cb) {
            var attachment = {};
            attachment[opts.attName] = {
                'content-type': opts.mimeType,
                data: util.btoa(data)
            };
            cb(null, attachment)
        },

        /**
         *
         * @param opts
         * @param {Blob} opts.data - blob
         * @param opts.mimeType,
         * @param opts.attName
         * @param cb
         */
        constructAttachmentFromBlob: function (opts, cb) {
            var reader = new FileReader();
            reader.onloadend = function () {
                var b64 = reader.result;
                var attachment = {};
                attachment[opts.attName] = {
                    'content-type': opts.mimeType,
                    data: b64
                };
                cb(null, attachment);
            };
            reader.onerror = function (err) {
                cb(err);
            };
            reader.readAsDataURL(opts.data);
        },
        /**
         *
         * @param opts
         * @param {string} opts.url - a url to something
         * @param opts.attName
         * @param [opts.mimeType]
         * @param cb
         */
        constructAttachmentFromURL: function (opts, cb) {
            this.http.xhrHttp({
                method: 'GET',
                responseType: 'blob',
                url: opts.url
            }, function (errStatus, data, xhr) {
                if (!errStatus) {
                    opts.data = data; // response is a Blob object.
                    this.constructAttachmentFromBlob(opts, cb);
                }
                else {
                    cb(new CouchError({
                        message: 'Error getting attachment from URL: ' + opts.url,
                        xhr: xhr,
                        status: errStatus
                    }))
                }
            }.bind(this));
        }
    };

    module.exports = function (auth, http, opts) {
        return new Attachments(auth, http, opts);
    };
})(this);
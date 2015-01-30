(function (root) {

    var _ = require('nimble'),
        merge = require('merge'),
        nodeHttp = require('http'),
        url = require('url');

    var btoa = root.btoa;
    if (!btoa) btoa = function (str) {
        return new Buffer(str).toString('base64');
    };

    /**
     * Normalise the host parameter e.g. standardise forward slash, protocol etc.
     * @param host
     * @returns {*}
     */
    function normaliseHost(host) {
        host = host || 'http://localhost:5984';
        if (host.length) {
            if (host[host.length - 1] == '/') {
                host = host.substring(0, host.length - 1);
            }
        }
        return host.replace('http://', '');
    }

    function normaliseDb(db) {
        return db || 'db';
    }

    function isString(str) {
        return typeof str == 'string' || str instanceof String;
    }

    function isObject(o) {
        return typeof o == 'object';
    }

    /**
     *
     * @param {Array} required - List of options that cannot be null/undefined
     * @param {Object} opts - The options to be verified
     * @param {Function} [cb] - Callback to callback with an error.
     * @returns {Array} missingOptions
     */
    function assertOptions(required, opts, cb) {
        var missing = [];
        required.forEach(function (opt) {
            if (opts[opt] == undefined) missing.push(opt);
        });
        if (missing.length && cb) cb(new CouchError({message: 'Missing options: ' + missing.join(', ')}));
        return missing;
    }

    var AUTH_METHOD = {
        BASIC: 'basic'
    };

    var MIME = {
        JSON: 'application/json',
        PLAIN_TEXT: 'text/plain'
    };

    var DEFAULT_ADMIN = 'admin';

    /**
     * @param arr
     * @constructor
     */
    function Set(arr) {
        arr.forEach(function (el) {
            this[el] = el;
        }.bind(this));
    }

    Set.prototype.memberOf = function (obj) {
        return obj in this;
    };

    var IGNORE_DATABASES = new Set(['_replicator']);

    var couchdb = function (opts) {
        opts = opts || {};

        var host = normaliseHost(opts.host),
            defaultDB = normaliseDb(opts.db);

        /**
         * Encapsulates auth strategy e.g. session, token. Used in every HTTP request to couch.
         */
        var auth = null,
            adminAuth = {
                method: AUTH_METHOD.BASIC,
                username: DEFAULT_ADMIN,
                password: DEFAULT_ADMIN
            };


        /**
         * Encapsulates errors produced whilst interacting with CouchDB over HTTP.
         *
         * @param opts
         * @param {String} [opts.message] - Error message
         * @param {jqXHR|XMLHttpRequest} [opts.xhr] - a jqXHR or XMLHttprequest object
         * @param {Error} [opts.thrown] - An Error object
         * @constructor
         */
        function CouchError(opts) {
            merge(this, opts);
            this.isError = true;
            Object.defineProperties(this, {
                isHttpError: {
                    get: function () {
                        return !!(this.isNodeHttpError || this.isBrowserHttpError);
                    }
                },
                isNodeHttpError: {
                    get: function () {
                        return !!this.response;
                    }
                },
                isBrowserHttpError: {
                    get: function () {
                        return !!this.xhr;
                    }
                },
                isThrownError: {
                    get: function () {
                        return !!this.thrown;
                    }
                },
                isUserError: {
                    get: function () {
                        return !this.isThrownError && !this.isHttpError
                    }
                }
            });
        }

        /**
         * Configure the ajax/nodeHttp options to match the configured authorisation method.
         * @param opts
         * @param auth
         * @private
         */
        function _configureAuth(opts, auth) {
            if (auth) {
                var headers = opts.headers || {};
                opts.headers = headers;
                // Allow for authorization overrides.
                if (!headers.Authorization) {
                    if (auth.method == AUTH_METHOD.BASIC) {
                        // Note: jQuery >=1.7 has username/password options. I do this simply for backwards
                        // compatibility.
                        headers.Authorization = 'Basic ' + btoa(auth.username + ':' + auth.password);
                    }
                }
            }
        }

        /**
         *
         * @param opts
         * @param opts.path
         * @param [opts.protocol]
         * @returns {string}
         * @private
         */
        function _constructURL(opts) {
            var protocol = opts.protocol || 'http://',
                path = opts.path;
            return protocol + host + (path.length ? (path[0] == '/' ? '' : '/') : '') + path;
        }

        /**
         * transform data into a string depending on the mimetype
         * @param mimeType
         * @param data
         * @returns {*}
         */
        function coerceData(mimeType, data) {
            var coercedData;
            if (mimeType == MIME.JSON) {
                if (data) {
                    if (!isString(data)) {
                        try {
                            coercedData = JSON.stringify(data);
                        }
                        catch (e) {
                            return new CouchError({thrown: e});
                        }
                    }
                }
            }
            else {
                coercedData = data;
            }
            return coercedData;
        }

        /**
         * Send a HTTP request using jquery
         * @param opts - The usual jquery opts +
         * @param opts.path - Path to append to host
         * @param opts.admin - True if endpoint requires admin access
         * @param opts.ignoreAuth
         * @param opts.contentType
         * @param [cb]
         * @private
         */
        function _$http(opts, cb) {
            cb = cb || function () {
                // Do nothing.
            };
            opts = merge({
                type: 'GET',
                contentType: MIME.JSON
            }, opts || {});
            var coercedData = coerceData(opts.contentType, opts.data);
            if (coercedData && coercedData.isError) {
                cb(coercedData);
                return;
            }
            if (coercedData != undefined) opts.data = coercedData;
            if (!opts.ignoreAuth) _configureAuth(opts, opts.admin ? adminAuth : auth);
            var path = opts.path || '';
            if (opts.path != null) delete opts.path;
            if (!opts.url) opts.url = _constructURL({path: path});
            console.info('[CouchDB: HTTP Request]:', opts);
            $.ajax(opts).done(function (data, textStatus, jqXHR) {
                console.info('[CouchDB: HTTP Response]:', {
                    opts: opts,
                    jqXHR: jqXHR,
                    textStatus: textStatus,
                    status: jqXHR.status
                });
                cb(null, data, jqXHR);
            }).fail(function (jqXHR, textStatus, errorThrown) {
                console.info('[CouchDB: HTTP Response]:', {
                    opts: opts,
                    jqXHR: jqXHR,
                    textStatus: textStatus,
                    errorThrown: errorThrown,
                    status: jqXHR.status
                });
                if (errorThrown instanceof Error) {
                    cb(new CouchError({thrown: errorThrown}));
                }
                else {
                    cb(new CouchError({message: errorThrown, xhr: jqXHR, status: jqXHR.status, opts: opts}));
                }
            });
        }

        /**
         * Best efforts at ensuring that a string represents a MIME type.
         * @param {String} [dataType]
         */
        function ensureMimeType(dataType) {
            if (dataType) {
                if (dataType.trim() == 'json') {
                    dataType = MIME.JSON;
                }
            }
            return dataType;
        }

        /**
         * Send a http request using node. Shims from jquery style ajax opts
         * @param opts
         * @param opts.type
         * @param [opts.path]
         * @param [opts.url] - if url is present, path will be ignored!
         * @param [opts.contentType] - Content type of data being sent
         * @param [opts.dataType] - Expected response type
         * @param [opts.ignoreAuth]
         * @param opts.data - Must be a string at the moment
         * @param opts.admin - if true, will use configured admin credentials
         * @param cb
         * @private
         */
        function _nHttp(opts, cb) {
            var parsedURL;
            if (opts.url) {
                parsedURL = url.parse(opts.url);
                // Check that the url param wasnt just a path...
                if (!parsedURL.host) parsedURL = url.parse(_constructURL({path: opts.url}));
            }
            else {
                parsedURL = url.parse(_constructURL({path: opts.path || ''}))
            }

            var data = opts.data,
                requestType = 'contentType' in opts ? opts.contentType : MIME.JSON,
                responseType = ensureMimeType(opts.dataType),
                method = opts.type || 'GET';

            var httpOpts = {
                method: method,
                hostname: parsedURL.hostname,
                port: parsedURL.port,
                path: parsedURL.path
            };


            if (requestType) {
                if (data) data = coerceData(requestType, data);
                httpOpts.headers = {'content-type': requestType};
            }
            if (!opts.ignoreAuth) _configureAuth(httpOpts, opts.admin ? adminAuth : auth);
            var req = nodeHttp.request(httpOpts, function (res) {
                // Override to prevent circular JSON errors.
                var responseString = '';


                res.on('data', function (chunk) {
                    responseString += chunk;
                });

                res.on('end', function () {
                    var statusCode = res.statusCode,
                        isSuccess = statusCode >= 200 && statusCode < 300;
                    if (isSuccess) {
                        var parsedResponse;
                        var _responseType = (responseType || res.headers['content-type'].split(';')[0]).trim();
                        if (_responseType) {
                            if (_responseType == MIME.JSON) {
                                try {
                                    parsedResponse = JSON.parse(responseString);
                                }
                                catch (e) {
                                    cb(new CouchError({thrown: e}));
                                }
                            }
                            else {
                                parsedResponse = responseString;
                            }

                        }
                        else {
                            parsedResponse = responseString;
                        }
                        cb(null, parsedResponse, res);

                    }
                    else {
                        cb(new CouchError({response: res, status: statusCode}));
                    }
                });
            });

            if (data)  req.write(data);

            req.end();
        }

        /**
         * Send a HTTP request. Uses either jquery or nodes http depending on what's available in the environment
         * @param opts - jquery style http opts
         * @param cb
         * @private
         */
        function _http(opts, cb) {
            if (nodeHttp) {
                _nHttp(opts, cb);
            }
            else {
                _$http(opts, cb);
            }
        }

        /**
         * Send a HTTP request or multiple http requests in parallel
         * @param {Object|Array} opts - The usual jquery opts, or an array of them.
         * @param {Object} [opts.path] - Path to append to host
         * @param {Function} [cb]
         */
        var http = function (opts, cb) {
            if (Array.isArray(opts)) {
                _.parallel(opts.map(function (_opts) {
                    return function (done) {
                        _http(_opts, done);
                    }
                }), cb);
            }
            else {
                _http(opts, cb);
            }
        };


        /**
         * A wrapper around XMLHttpRequest. This exists due to some short-comings in jquery ajax around blobs.
         * If we're in the Node environment, this will simply pass onto Node.
         * @param opts
         * @param opts.method
         * @param opts.responseType
         * @param opts.url
         * @param cb
         * @private
         */
        var _xhrHttp = function (opts, cb) {
            var method = opts.method || 'GET',
                responseType = opts.responseType;
            cb = cb || function () {
            };
            if (nodeHttp) {
                // No need to use XHR
                var nodeHTTPOpts = {
                    url: opts.url,
                    type: method
                };
                // No concept of HTML5 blob in Node.
                if (responseType != 'blob') {
                    nodeHTTPOpts['responseType'] = responseType;
                }
                _nHttp(nodeHTTPOpts, cb);
            }
            else {
                var XMLHttpRequest = global['XMLHttpRequest'];
                var xhr = new XMLHttpRequest();
                xhr.onreadystatechange = function () {
                    if (this.readyState == 4) {
                        if (this.status == 200) cb(null, this.response, xhr);
                        else cb(this.status, this.response, xhr);
                    }
                };
                xhr.open(method, opts.url);
                if (responseType) {
                    xhr.responseType = responseType;
                }
                xhr.send();
            }
        };

        /**
         * same as http except default to json
         * @param opts
         * @param cb
         */
        var json = function (opts, cb) {
            function _json(opts) {
                opts.dataType = 'json';
            }

            if (Array.isArray(opts)) {
                opts.forEach(_json);
            }
            else {
                _json(opts);
            }
            http(opts, cb);
        };

        /**
         * CouchDB has a weird convention for user identifiers. This function simply transforms the username into
         * to match that convention.
         * @param username
         * @returns {string}
         * @private
         */
        function _getFullyQualifedUsername(username) {
            return 'org.couchdb.user:' + username;
        }

        /**
         * @param opts
         * @param opts.username
         * @param opts.password
         * @param cb
         */
        var createUser = function (opts, cb) {
            var username = opts.username,
                password = opts.password;
            var fullyQualifiedUsername = _getFullyQualifedUsername(username);
            json({
                path: '_users/' + fullyQualifiedUsername,
                type: 'PUT',
                data: {
                    _id: fullyQualifiedUsername,
                    name: username,
                    type: 'user',
                    roles: [],
                    password: password
                }
            }, cb);
        };

        /**
         * The first time, an admin user can be created without any permissions. Subsequently, you must authenticate
         * as an another admin user
         * @param [cb]
         */
        var createAdminUser = function (cb) {
            json({
                path: '_config/admins/' + adminAuth.username,
                type: 'PUT',
                data: '"' + adminAuth.password + '"',
                admin: true
            }, cb);
        };

        /**
         * Verify that username/password combination is correct by hitting the _session endpoint.
         * If this is the case, configure future authorisation method accordingly.
         * @param authOpts
         * @param authOpts.username
         * @param authOpts.password
         * @param cb
         */
        var basicAuth = function (authOpts, cb) {
            var username = authOpts.username,
                password = authOpts.password;
            var httpOpts = {
                path: '_session',
                type: 'POST',
                contentType: "application/x-www-form-urlencoded",
                data: 'name=' + username + '&password=' + password
            };
            json(httpOpts, function (err, data) {
                if (!err) {
                    if (data.ok) {
                        auth = {
                            method: AUTH_METHOD.BASIC,
                            username: username,
                            password: password,
                            user: data
                        };
                        cb();
                    }
                    else {
                        cb(new CouchError(data));
                    }
                }
                else {
                    cb(err);
                }
            });
        };


        /**
         * Admin users are different with CouchDB and don't exist under the normal _users database.
         * @param [authOpts]
         * @param [authOpts.username]
         * @param [authOpts.password]
         * @param cb
         */
        var adminLogin = function (authOpts, cb) {
            // Only admins can read global config, therefore we test that credentials are correct by querying that
            // database.
            json({
                path: '_config'
            }, function (err) {
                if (!err) {
                    adminAuth = merge({}, authOpts);
                    adminAuth.method = AUTH_METHOD.BASIC;
                }
                cb(err);
            });
        };

        function optsOrCallback(optsOrCb, cb) {
            var opts;
            if (optsOrCb instanceof Function) {
                cb = optsOrCb;
                opts = {};
            }
            else {
                opts = optsOrCb;
            }
            return {opts: opts, cb: cb};
        }

        /**
         * Public API providing access to the backing CouchDB instance.
         */
        var API;
        //noinspection JSCommentMatchesSignature,JSCommentMatchesSignature,JSValidateJSDoc
        API = {
            info: function (cb) {
                json({path: ''}, cb);
            },
            createUser: createUser,
            basicAuth: basicAuth,
            adminLogin: adminLogin,
            logout: function () {
                auth = null;
            },
            admin: {
                createAdminUser: createAdminUser,
                /**
                 * Clear out the database. Useful during testing.
                 * @param [optsOrCb]
                 * @param cb
                 */
                deleteAllDatabases: function (optsOrCb, cb) {
                    var __ret = optsOrCallback(optsOrCb, cb),
                        opts = __ret.opts;
                    cb = __ret.cb;
                    opts.path = '_all_dbs';
                    opts.admin = true;
                    json(opts, function (err, data) {
                        if (err) cb(err);
                        else {
                            var ajaxOpts = data.reduce(function (memo, dbName) {
                                if (!IGNORE_DATABASES.memberOf(dbName)) {
                                    memo.push({
                                        type: 'DELETE',
                                        path: dbName,
                                        admin: true
                                    });
                                }
                                return memo;
                            }, []);
                            json(ajaxOpts, cb);
                        }
                    });
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
                    var database = opts.database || defaultDB,
                        id = opts.id,
                        remove = opts.remove;
                    var path = database + '/' + id;
                    json(merge(true, opts, {
                        path: path,
                        admin: opts.admin
                    }), function (err, resp) {
                        var found = true;
                        if (err) {
                            if (err.status == API.HTTP_STATUS.NOT_FOUND) found = false;
                            else {
                                cb(err);
                                return;
                            }
                        }
                        if (remove && found) {
                            // delete it
                            path += '?rev=' + resp._rev;
                            json(merge(true, opts, {
                                type: 'DELETE',
                                path: path,
                                admin: opts.admin
                            }), cb);
                        }
                        else if (!remove) {
                            // create or update it
                            if (found) doc._rev = resp._rev;
                            json(merge(true, opts, {
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
                    })
                },

                /**
                 * Clear out the database. Useful during testing.
                 * @param [optsOrCb]
                 * @param [optsOrCb.username] - admin username
                 * @param [optsOrCb.password] - admin password
                 * @param cb
                 */
                reset: function (optsOrCb, cb) {
                    var __ret = optsOrCallback(optsOrCb, cb),
                        opts = __ret.opts;
                    cb = __ret.cb;
                    API.admin.deleteAllDatabases(opts, function (err) {
                        if (!err) API.logout();
                        cb(err);
                    });
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
                            API.admin._toggleDoc(doc, {
                                id: '_design/blockAnonymousUpdates',
                                remove: opts.anonymousUpdates,
                                admin: true
                            }, done);
                        });
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
                            API.admin._toggleDoc(doc, {
                                id: '_design/blockAnonymousReads',
                                remove: opts.anonymousReads,
                                admin: true
                            }, done);
                        });
                    }
                    _.parallel(tasks, cb);
                }
                , /**
                 *
                 * @param [optsOrCb]
                 * @param [optsOrCb.database]
                 * @param [optsOrCb.anonymousUpdates]
                 * @param [optsOrCb.anonymousReads]
                 * @param [cb]
                 */
                createDatabase: function (optsOrCb, cb) {
                    var __ret = optsOrCallback(optsOrCb, cb);
                    var opts = __ret.opts;
                    cb = __ret.cb;
                    opts.path = opts.database || defaultDB;
                    opts.type = 'PUT';
                    opts.admin = true;
                    json(opts, function (err) {
                        if (!err) {
                            this.configureDatabase(opts, cb);
                        } else cb(err);
                    }.bind(this));
                }
                ,

                /**
                 * @param [optsOrCb]
                 * @param [optsOrCb.database]
                 * @param [cb]
                 */
                getPermissions: function (optsOrCb, cb) {
                    var __ret = optsOrCallback(optsOrCb, cb);
                    var opts = __ret.opts;
                    cb = __ret.cb;
                    var database = opts.database || defaultDB;
                    opts.path = database + '/_security';
                    opts.admin = true;
                    json(opts, cb);
                }

            },
            HTTP_STATUS: {
                UNAUTHORISED: 401,
                CONFLICT: 409,
                NOT_FOUND: 404,
                FORBIDDEN: 403
            },
            AUTH_METHOD: AUTH_METHOD,
            /**
             * Verify that the configuration is ok.
             * @param cb
             */
            verify: function (cb) {
                json({
                    path: defaultDB
                }, cb);
            },

            _upsertDocumentArguments: function (arguments) {
                var doc, opts, cb;
                if (isObject(arguments[0]) && isObject(arguments[1])) {
                    doc = arguments[0];
                    opts = arguments[1];
                    cb = arguments[2];
                }
                else if (isObject(arguments[0])) {
                    doc = arguments[0];
                    opts = {};
                    cb = arguments[1];
                }
                else {
                    doc = {};
                    opts = {};
                    cb = arguments[0];
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
            }, /**
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
                path = opts.db || defaultDB;
                if (id) path += '/' + id;
                if (auth) {
                    if ('user' in doc) {
                        cb(new CouchError({message: 'the user field is reserved'}));
                        return;
                    }
                    doc.user = auth.user.name;
                }
                json({
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
                        var isConflict = err.status == API.HTTP_STATUS.CONFLICT,
                            shouldMerge = opts.conflicts == 'merge';
                        if (shouldMerge && isConflict) {
                            API._merge(doc, opts, cb);
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
                API.getDocument(doc._id, opts, function (err, resp) {
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
                var __ret = optsOrCallback(optsOrCb, cb),
                    opts = __ret.opts;
                cb = __ret.cb;
                var database = opts.database || defaultDB;
                json({
                    path: database + '/' + _id
                }, cb);
            },

            getUser: function (username, cb) {
                var fullyQualifiedUsername = _getFullyQualifedUsername(username);
                json({
                    path: '_users/' + fullyQualifiedUsername
                }, cb);
            },

            /**
             *
             * @param opts
             * @param opts.doc - a document with _id or an string representation of _id
             * @param opts.attName - name of the attachment
             * @param [cb]
             */
            getAttachment: function (opts, cb) {
                var database = opts.db || defaultDB,
                    id = isString(opts.doc) ? opts.doc : opts.doc._id,
                    path = database + '/' + id + '/' + opts.attName;
                http({
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
                    if (assertOptions(['data', 'mimeType', 'attName', 'doc'], opts, cb).length) return;
                    var database = opts.db || defaultDB,
                        id = isString(opts.doc) ? opts.doc : opts.doc._id,
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
                    http(httpOpts, cb);
                }
                else if (opts.url) {
                    if (assertOptions(['url', 'attName', 'doc'], opts, cb).length) return;
                    /*
                     jquery ajax does not support blobs
                     http://stackoverflow.com/questions/17657184/using-jquerys-ajax-method-to-retrieve-images-as-a-blob
                     even if not using blob kept experiencing issues with corruption of image data.
                     It's probably something to do with encoding but will XHR for this for now.
                     TODO: Use jquery instead for the below (if possible)
                     */
                    _xhrHttp({
                        method: 'GET',
                        url: opts.url,
                        responseType: 'blob'
                    }, function (errStatus, data, xhr) {
                        if (!errStatus) {
                            var database = opts.db || defaultDB,
                                id = isString(opts.doc) ? opts.doc : opts.doc._id,
                                rev = opts.doc._rev,
                                mimeType = opts.mimeType || false,
                                path = database + '/' + id + '/' + opts.attName;
                            if (rev) path += '?rev=' + rev;
                            http({
                                path: path,
                                type: 'PUT',
                                data: data,
                                processData: false,
                                contentType: mimeType
                            }, cb);
                        }
                        else {
                            cb(new CouchError({xhr: xhr, status: errStatus}));
                        }
                    });
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
                    data: btoa(data)
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
                _xhrHttp({
                    method: 'GET',
                    responseType: 'blob',
                    url: opts.url
                }, function (errStatus, data, xhr) {
                    if (!errStatus) {
                        opts.data = data; // response is a Blob object.
                        API.constructAttachmentFromBlob(opts, cb);
                    }
                    else {
                        cb(new CouchError({
                            message: 'Error getting attachment from URL: ' + opts.url,
                            xhr: xhr,
                            status: errStatus
                        }))
                    }
                });
            }
        };

        Object.defineProperty(API, 'auth', {
            get: function () {
                return auth;
            },
            set: function (_auth) {
                auth = _auth
            },
            configurable: false,
            enumerable: true
        });


        return API;

    };

    root.couchdb = couchdb;

})(this);
(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global,Buffer){
(function (root) {

    var _ = require('nimble'),
        merge = require('merge'),
        nodeHttp = null,
        url = null;

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
            cb = cb || function () {
            };
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
         * @param opts.auth - the auth method to use
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
            }, function (err, resp) {
                var user;
                if (!err) {
                    user = {
                        name: username,
                        username: username,
                        _id: resp.id,
                        _rev: resp.rev
                    };
                    if (opts.auth) {
                        if (opts.auth == AUTH_METHOD.BASIC) {
                            auth = {
                                method: AUTH_METHOD.BASIC,
                                username: username,
                                password: password,
                                user: user
                            };
                            user.password = password;
                        }
                        else {
                            cb(new CouchError({message: 'NYI: Auth method "' + opts.auth + '"'}));
                        }
                    }
                }
                cb(err, user);
            });
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
                        data.username = username;
                        data.password = password;
                        data.name = username;
                        cb(null, data);
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
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)

},{"buffer":2,"merge":6,"nimble":7}],2:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new TypeError('must start with number, buffer, array or string')

  if (length > kMaxLength)
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
      'size: 0x' + kMaxLength.toString(16) + ' bytes')

  var buf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize)
    buf.parent = rootParent

  return buf
}

function SlowBuffer(subject, encoding, noZero) {
  if (!(this instanceof SlowBuffer))
    return new SlowBuffer(subject, encoding, noZero)

  var buf = new Buffer(subject, encoding, noZero)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b))
    throw new TypeError('Arguments must be Buffers')

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase)
          throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max)
      str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length, 2)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length)
    throw new RangeError('attempt to write outside buffer bounds');

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length)
    newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0)
    throw new RangeError('offset is not uint')
  if (offset + ext > length)
    throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100))
    val += this[offset + i] * mul

  return val
}

Buffer.prototype.readUIntBE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100))
    val += this[offset + --byteLength] * mul;

  return val
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
}

Buffer.prototype.readIntLE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100))
    val += this[offset + i] * mul
  mul *= 0x80

  if (val >= mul)
    val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function (offset, byteLength, noAssert) {
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100))
    val += this[offset + --i] * mul
  mul *= 0x80

  if (val >= mul)
    val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80))
    return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100))
    this[offset + i] = (value / mul) >>> 0 & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert)
    checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100))
    this[offset + i] = (value / mul) >>> 0 & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

Buffer.prototype.writeIntLE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(this,
             value,
             offset,
             byteLength,
             Math.pow(2, 8 * byteLength - 1) - 1,
             -Math.pow(2, 8 * byteLength - 1))
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100))
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(this,
             value,
             offset,
             byteLength,
             Math.pow(2, 8 * byteLength - 1) - 1,
             -Math.pow(2, 8 * byteLength - 1))
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100))
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || source.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0)
    throw new RangeError('targetStart out of bounds')
  if (start < 0 || start >= source.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes(string, units) {
  var codePoint, length = string.length
  var leadSurrogate = null
  units = units || Infinity
  var bytes = []
  var i = 0

  for (; i<length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {

      // last char was a lead
      if (leadSurrogate) {

        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        }

        // valid surrogate pair
        else {
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      }

      // no lead yet
      else {

        // unexpected trail
        if (codePoint > 0xDBFF) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // unpaired lead
        else if (i + 1 === length) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        else {
          leadSurrogate = codePoint
          continue
        }
      }
    }

    // valid bmp char, but last char was a lead
    else if (leadSurrogate) {
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    }
    else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      );
    }
    else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    }
    else if (codePoint < 0x200000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      );
    }
    else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {

    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length, unitSize) {
  if (unitSize) length -= length % unitSize;
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":3,"ieee754":4,"is-array":5}],3:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],5:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],6:[function(require,module,exports){
/*!
 * @name JavaScript/NodeJS Merge v1.2.0
 * @author yeikos
 * @repository https://github.com/yeikos/js.merge

 * Copyright 2014 yeikos - MIT license
 * https://raw.github.com/yeikos/js.merge/master/LICENSE
 */

;(function(isNode) {

	/**
	 * Merge one or more objects 
	 * @param bool? clone
	 * @param mixed,... arguments
	 * @return object
	 */

	var Public = function(clone) {

		return merge(clone === true, false, arguments);

	}, publicName = 'merge';

	/**
	 * Merge two or more objects recursively 
	 * @param bool? clone
	 * @param mixed,... arguments
	 * @return object
	 */

	Public.recursive = function(clone) {

		return merge(clone === true, true, arguments);

	};

	/**
	 * Clone the input removing any reference
	 * @param mixed input
	 * @return mixed
	 */

	Public.clone = function(input) {

		var output = input,
			type = typeOf(input),
			index, size;

		if (type === 'array') {

			output = [];
			size = input.length;

			for (index=0;index<size;++index)

				output[index] = Public.clone(input[index]);

		} else if (type === 'object') {

			output = {};

			for (index in input)

				output[index] = Public.clone(input[index]);

		}

		return output;

	};

	/**
	 * Merge two objects recursively
	 * @param mixed input
	 * @param mixed extend
	 * @return mixed
	 */

	function merge_recursive(base, extend) {

		if (typeOf(base) !== 'object')

			return extend;

		for (var key in extend) {

			if (typeOf(base[key]) === 'object' && typeOf(extend[key]) === 'object') {

				base[key] = merge_recursive(base[key], extend[key]);

			} else {

				base[key] = extend[key];

			}

		}

		return base;

	}

	/**
	 * Merge two or more objects
	 * @param bool clone
	 * @param bool recursive
	 * @param array argv
	 * @return object
	 */

	function merge(clone, recursive, argv) {

		var result = argv[0],
			size = argv.length;

		if (clone || typeOf(result) !== 'object')

			result = {};

		for (var index=0;index<size;++index) {

			var item = argv[index],

				type = typeOf(item);

			if (type !== 'object') continue;

			for (var key in item) {

				var sitem = clone ? Public.clone(item[key]) : item[key];

				if (recursive) {

					result[key] = merge_recursive(result[key], sitem);

				} else {

					result[key] = sitem;

				}

			}

		}

		return result;

	}

	/**
	 * Get type of variable
	 * @param mixed input
	 * @return string
	 *
	 * @see http://jsperf.com/typeofvar
	 */

	function typeOf(input) {

		return ({}).toString.call(input).slice(8, -1).toLowerCase();

	}

	if (isNode) {

		module.exports = Public;

	} else {

		window[publicName] = Public;

	}

})(typeof module === 'object' && module && typeof module.exports === 'object' && module.exports);
},{}],7:[function(require,module,exports){
/**
 * Nimble
 * Copyright (c) 2011 Caolan McMahon
 *
 * Nimble is freely distributable under the MIT license.
 *
 * This source code is optimized for minification and gzip compression, not
 * readability. If you want reassurance, see the test suite.
 */

(function (exports) {

    var keys = Object.keys || function (obj) {
        var results = [];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) {
                results.push(k);
            }
        }
        return results;
    };

    var fallback = function (name, fallback) {
        var nativeFn = Array.prototype[name];
        return function (obj, iterator, memo) {
            var fn = obj ? obj[name]: 0;
            return fn && fn === nativeFn ?
                fn.call(obj, iterator, memo):
                fallback(obj, iterator, memo);
        };
    };

    var eachSync = fallback('forEach', function (obj, iterator) {
        var isObj = obj instanceof Object;
        var arr = isObj ? keys(obj): (obj || []);
        for (var i = 0, len = arr.length; i < len; i++) {
            var k = isObj ? arr[i]: i;
            iterator(obj[k], k, obj);
        }
    });

    var eachParallel = function (obj, iterator, callback) {
        var len = obj.length || keys(obj).length;
        if (!len) {
            return callback();
        }
        var completed = 0;
        eachSync(obj, function () {
            var cb = function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    if (++completed === len) {
                        callback();
                    }
                }
            };
            var args = Array.prototype.slice.call(arguments);
            if (iterator.length) {
                args = args.slice(0, iterator.length - 1);
                args[iterator.length - 1] = cb;
            }
            else {
                args.push(cb);
            }
            iterator.apply(this, args);
        });
    };

    var eachSeries = function (obj, iterator, callback) {
        var keys_list = keys(obj);
        if (!keys_list.length) {
            return callback();
        }
        var completed = 0;
        var iterate = function () {
            var k = keys_list[completed];
            var args = [obj[k], k, obj].slice(0, iterator.length - 1);
            args[iterator.length - 1] = function (err) {
                if (err) {
                    callback(err);
                    callback = function () {};
                }
                else {
                    if (++completed === keys_list.length) {
                        callback();
                    }
                    else {
                        iterate();
                    }
                }
            };
            iterator.apply(this, args);
        };
        iterate();
    };

    var mapSync = fallback('map', function (obj, iterator) {
        var results = [];
        eachSync(obj, function (v, k, obj) {
            results[results.length] = iterator(v, k, obj);
        });
        return results;
    });

    var mapAsync = function (eachfn) {
        return function (obj, iterator, callback) {
            var results = [];
            eachfn(obj, function (value, i, obj, callback) {
                var cb = function (err, v) {
                    results[results.length] = v;
                    callback(err);
                };
                var args = [value, i, obj];
                if (iterator.length) {
                    args = args.slice(0, iterator.length - 1);
                    args[iterator.length - 1] = cb;
                }
                else {
                    args.push(cb);
                }
                iterator.apply(this, args);
            }, function (err) {
                callback(err, results);
            });
        };
    };

    var filterSync = fallback('filter', function (obj, iterator, callback) {
        var results = [];
        eachSync(obj, function (v, k, obj) {
            if (iterator(v, k, obj)) {
                results[results.length] = v;
            }
        });
        return results;
    });

    var filterParallel = function (obj, iterator, callback) {
        var results = [];
        eachParallel(obj, function (value, k, obj, callback) {
            var cb = function (err, a) {
                if (a) {
                    results[results.length] = value;
                }
                callback(err);
            };
            var args = [value, k, obj];
            if (iterator.length) {
                args = args.slice(0, iterator.length - 1);
                args[iterator.length - 1] = cb;
            }
            else {
                args.push(cb);
            }
            iterator.apply(this, args);
        }, function (err) {
            callback(err, results);
        });
    };

    var reduceSync = fallback('reduce', function (obj, iterator, memo) {
        eachSync(obj, function (v, i, obj) {
            memo = iterator(memo, v, i, obj);
        });
        return memo;
    });

    var reduceSeries = function (obj, iterator, memo, callback) {
        eachSeries(obj, function (value, i, obj, callback) {
            var cb = function (err, v) {
                memo = v;
                callback(err);
            };
            var args = [memo, value, i, obj];
            if (iterator.length) {
                args = args.slice(0, iterator.length - 1);
                args[iterator.length - 1] = cb;
            }
            else {
                args.push(cb);
            }
            iterator.apply(this, args);
        }, function (err) {
            callback(err, memo);
        });
    };

    exports.each = function (obj, iterator, callback) {
        return (callback ? eachParallel: eachSync)(obj, iterator, callback);
    };
    exports.map = function (obj, iterator, callback) {
        return (callback ? mapAsync(eachParallel): mapSync)(obj, iterator, callback);
    };
    exports.filter = function (obj, iterator, callback) {
        return (callback ? filterParallel: filterSync)(obj, iterator, callback);
    };
    exports.reduce = function (obj, iterator, memo, callback) {
        return (callback ? reduceSeries: reduceSync)(obj, iterator, memo, callback);
    };

    exports.parallel = function (fns, callback) {
        var results = new fns.constructor();
        eachParallel(fns, function (fn, k, cb) {
            fn(function (err) {
                var v = Array.prototype.slice.call(arguments, 1);
                results[k] = v.length <= 1 ? v[0]: v;
                cb(err);
            });
        }, function (err) {
            (callback || function () {})(err, results);
        });
    };

    exports.series = function (fns, callback) {
        var results = new fns.constructor();
        eachSeries(fns, function (fn, k, cb) {
            fn(function (err, result) {
                var v = Array.prototype.slice.call(arguments, 1);
                results[k] = v.length <= 1 ? v[0]: v;
                cb(err);
            });
        }, function (err) {
            (callback || function () {})(err, results);
        });
    };

}(typeof exports === 'undefined' ? this._ = this._ || {}: exports));

},{}]},{},[1])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJmcm9udC9zcmMvY291Y2hkYi5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9tZXJnZS9tZXJnZS5qcyIsIm5vZGVfbW9kdWxlcy9uaW1ibGUvbmltYmxlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN6bUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNweUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKHJvb3QpIHtcblxuICAgIHZhciBfID0gcmVxdWlyZSgnbmltYmxlJyksXG4gICAgICAgIG1lcmdlID0gcmVxdWlyZSgnbWVyZ2UnKSxcbiAgICAgICAgbm9kZUh0dHAgPSBudWxsLFxuICAgICAgICB1cmwgPSBudWxsO1xuXG4gICAgdmFyIGJ0b2EgPSByb290LmJ0b2E7XG4gICAgaWYgKCFidG9hKSBidG9hID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdHIpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogTm9ybWFsaXNlIHRoZSBob3N0IHBhcmFtZXRlciBlLmcuIHN0YW5kYXJkaXNlIGZvcndhcmQgc2xhc2gsIHByb3RvY29sIGV0Yy5cbiAgICAgKiBAcGFyYW0gaG9zdFxuICAgICAqIEByZXR1cm5zIHsqfVxuICAgICAqL1xuICAgIGZ1bmN0aW9uIG5vcm1hbGlzZUhvc3QoaG9zdCkge1xuICAgICAgICBob3N0ID0gaG9zdCB8fCAnaHR0cDovL2xvY2FsaG9zdDo1OTg0JztcbiAgICAgICAgaWYgKGhvc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAoaG9zdFtob3N0Lmxlbmd0aCAtIDFdID09ICcvJykge1xuICAgICAgICAgICAgICAgIGhvc3QgPSBob3N0LnN1YnN0cmluZygwLCBob3N0Lmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBob3N0LnJlcGxhY2UoJ2h0dHA6Ly8nLCAnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXNlRGIoZGIpIHtcbiAgICAgICAgcmV0dXJuIGRiIHx8ICdkYic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNTdHJpbmcoc3RyKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2Ygc3RyID09ICdzdHJpbmcnIHx8IHN0ciBpbnN0YW5jZW9mIFN0cmluZztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc09iamVjdChvKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgbyA9PSAnb2JqZWN0JztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHJlcXVpcmVkIC0gTGlzdCBvZiBvcHRpb25zIHRoYXQgY2Fubm90IGJlIG51bGwvdW5kZWZpbmVkXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdHMgLSBUaGUgb3B0aW9ucyB0byBiZSB2ZXJpZmllZFxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYl0gLSBDYWxsYmFjayB0byBjYWxsYmFjayB3aXRoIGFuIGVycm9yLlxuICAgICAqIEByZXR1cm5zIHtBcnJheX0gbWlzc2luZ09wdGlvbnNcbiAgICAgKi9cbiAgICBmdW5jdGlvbiBhc3NlcnRPcHRpb25zKHJlcXVpcmVkLCBvcHRzLCBjYikge1xuICAgICAgICB2YXIgbWlzc2luZyA9IFtdO1xuICAgICAgICByZXF1aXJlZC5mb3JFYWNoKGZ1bmN0aW9uIChvcHQpIHtcbiAgICAgICAgICAgIGlmIChvcHRzW29wdF0gPT0gdW5kZWZpbmVkKSBtaXNzaW5nLnB1c2gob3B0KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChtaXNzaW5nLmxlbmd0aCAmJiBjYikgY2IobmV3IENvdWNoRXJyb3Ioe21lc3NhZ2U6ICdNaXNzaW5nIG9wdGlvbnM6ICcgKyBtaXNzaW5nLmpvaW4oJywgJyl9KSk7XG4gICAgICAgIHJldHVybiBtaXNzaW5nO1xuICAgIH1cblxuICAgIHZhciBBVVRIX01FVEhPRCA9IHtcbiAgICAgICAgQkFTSUM6ICdiYXNpYydcbiAgICB9O1xuXG4gICAgdmFyIE1JTUUgPSB7XG4gICAgICAgIEpTT046ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgUExBSU5fVEVYVDogJ3RleHQvcGxhaW4nXG4gICAgfTtcblxuICAgIHZhciBERUZBVUxUX0FETUlOID0gJ2FkbWluJztcblxuICAgIC8qKlxuICAgICAqIEBwYXJhbSBhcnJcbiAgICAgKiBAY29uc3RydWN0b3JcbiAgICAgKi9cbiAgICBmdW5jdGlvbiBTZXQoYXJyKSB7XG4gICAgICAgIGFyci5mb3JFYWNoKGZ1bmN0aW9uIChlbCkge1xuICAgICAgICAgICAgdGhpc1tlbF0gPSBlbDtcbiAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICB9XG5cbiAgICBTZXQucHJvdG90eXBlLm1lbWJlck9mID0gZnVuY3Rpb24gKG9iaikge1xuICAgICAgICByZXR1cm4gb2JqIGluIHRoaXM7XG4gICAgfTtcblxuICAgIHZhciBJR05PUkVfREFUQUJBU0VTID0gbmV3IFNldChbJ19yZXBsaWNhdG9yJ10pO1xuXG4gICAgdmFyIGNvdWNoZGIgPSBmdW5jdGlvbiAob3B0cykge1xuICAgICAgICBvcHRzID0gb3B0cyB8fCB7fTtcblxuICAgICAgICB2YXIgaG9zdCA9IG5vcm1hbGlzZUhvc3Qob3B0cy5ob3N0KSxcbiAgICAgICAgICAgIGRlZmF1bHREQiA9IG5vcm1hbGlzZURiKG9wdHMuZGIpO1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBFbmNhcHN1bGF0ZXMgYXV0aCBzdHJhdGVneSBlLmcuIHNlc3Npb24sIHRva2VuLiBVc2VkIGluIGV2ZXJ5IEhUVFAgcmVxdWVzdCB0byBjb3VjaC5cbiAgICAgICAgICovXG4gICAgICAgIHZhciBhdXRoID0gbnVsbCxcbiAgICAgICAgICAgIGFkbWluQXV0aCA9IHtcbiAgICAgICAgICAgICAgICBtZXRob2Q6IEFVVEhfTUVUSE9ELkJBU0lDLFxuICAgICAgICAgICAgICAgIHVzZXJuYW1lOiBERUZBVUxUX0FETUlOLFxuICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBERUZBVUxUX0FETUlOXG4gICAgICAgICAgICB9O1xuXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEVuY2Fwc3VsYXRlcyBlcnJvcnMgcHJvZHVjZWQgd2hpbHN0IGludGVyYWN0aW5nIHdpdGggQ291Y2hEQiBvdmVyIEhUVFAuXG4gICAgICAgICAqXG4gICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBbb3B0cy5tZXNzYWdlXSAtIEVycm9yIG1lc3NhZ2VcbiAgICAgICAgICogQHBhcmFtIHtqcVhIUnxYTUxIdHRwUmVxdWVzdH0gW29wdHMueGhyXSAtIGEganFYSFIgb3IgWE1MSHR0cHJlcXVlc3Qgb2JqZWN0XG4gICAgICAgICAqIEBwYXJhbSB7RXJyb3J9IFtvcHRzLnRocm93bl0gLSBBbiBFcnJvciBvYmplY3RcbiAgICAgICAgICogQGNvbnN0cnVjdG9yXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBDb3VjaEVycm9yKG9wdHMpIHtcbiAgICAgICAgICAgIG1lcmdlKHRoaXMsIG9wdHMpO1xuICAgICAgICAgICAgdGhpcy5pc0Vycm9yID0gdHJ1ZTtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKHRoaXMsIHtcbiAgICAgICAgICAgICAgICBpc0h0dHBFcnJvcjoge1xuICAgICAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhISh0aGlzLmlzTm9kZUh0dHBFcnJvciB8fCB0aGlzLmlzQnJvd3Nlckh0dHBFcnJvcik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGlzTm9kZUh0dHBFcnJvcjoge1xuICAgICAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhIXRoaXMucmVzcG9uc2U7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGlzQnJvd3Nlckh0dHBFcnJvcjoge1xuICAgICAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAhIXRoaXMueGhyO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBpc1Rocm93bkVycm9yOiB7XG4gICAgICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICEhdGhpcy50aHJvd247XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIGlzVXNlckVycm9yOiB7XG4gICAgICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICF0aGlzLmlzVGhyb3duRXJyb3IgJiYgIXRoaXMuaXNIdHRwRXJyb3JcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENvbmZpZ3VyZSB0aGUgYWpheC9ub2RlSHR0cCBvcHRpb25zIHRvIG1hdGNoIHRoZSBjb25maWd1cmVkIGF1dGhvcmlzYXRpb24gbWV0aG9kLlxuICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgKiBAcGFyYW0gYXV0aFxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgZnVuY3Rpb24gX2NvbmZpZ3VyZUF1dGgob3B0cywgYXV0aCkge1xuICAgICAgICAgICAgaWYgKGF1dGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgaGVhZGVycyA9IG9wdHMuaGVhZGVycyB8fCB7fTtcbiAgICAgICAgICAgICAgICBvcHRzLmhlYWRlcnMgPSBoZWFkZXJzO1xuICAgICAgICAgICAgICAgIC8vIEFsbG93IGZvciBhdXRob3JpemF0aW9uIG92ZXJyaWRlcy5cbiAgICAgICAgICAgICAgICBpZiAoIWhlYWRlcnMuQXV0aG9yaXphdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXV0aC5tZXRob2QgPT0gQVVUSF9NRVRIT0QuQkFTSUMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE5vdGU6IGpRdWVyeSA+PTEuNyBoYXMgdXNlcm5hbWUvcGFzc3dvcmQgb3B0aW9ucy4gSSBkbyB0aGlzIHNpbXBseSBmb3IgYmFja3dhcmRzXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBjb21wYXRpYmlsaXR5LlxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0Jhc2ljICcgKyBidG9hKGF1dGgudXNlcm5hbWUgKyAnOicgKyBhdXRoLnBhc3N3b3JkKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgKiBAcGFyYW0gb3B0cy5wYXRoXG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5wcm90b2NvbF1cbiAgICAgICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIF9jb25zdHJ1Y3RVUkwob3B0cykge1xuICAgICAgICAgICAgdmFyIHByb3RvY29sID0gb3B0cy5wcm90b2NvbCB8fCAnaHR0cDovLycsXG4gICAgICAgICAgICAgICAgcGF0aCA9IG9wdHMucGF0aDtcbiAgICAgICAgICAgIHJldHVybiBwcm90b2NvbCArIGhvc3QgKyAocGF0aC5sZW5ndGggPyAocGF0aFswXSA9PSAnLycgPyAnJyA6ICcvJykgOiAnJykgKyBwYXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIHRyYW5zZm9ybSBkYXRhIGludG8gYSBzdHJpbmcgZGVwZW5kaW5nIG9uIHRoZSBtaW1ldHlwZVxuICAgICAgICAgKiBAcGFyYW0gbWltZVR5cGVcbiAgICAgICAgICogQHBhcmFtIGRhdGFcbiAgICAgICAgICogQHJldHVybnMgeyp9XG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBjb2VyY2VEYXRhKG1pbWVUeXBlLCBkYXRhKSB7XG4gICAgICAgICAgICB2YXIgY29lcmNlZERhdGE7XG4gICAgICAgICAgICBpZiAobWltZVR5cGUgPT0gTUlNRS5KU09OKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFpc1N0cmluZyhkYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2VyY2VkRGF0YSA9IEpTT04uc3RyaW5naWZ5KGRhdGEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IENvdWNoRXJyb3Ioe3Rocm93bjogZX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgY29lcmNlZERhdGEgPSBkYXRhO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvZXJjZWREYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNlbmQgYSBIVFRQIHJlcXVlc3QgdXNpbmcganF1ZXJ5XG4gICAgICAgICAqIEBwYXJhbSBvcHRzIC0gVGhlIHVzdWFsIGpxdWVyeSBvcHRzICtcbiAgICAgICAgICogQHBhcmFtIG9wdHMucGF0aCAtIFBhdGggdG8gYXBwZW5kIHRvIGhvc3RcbiAgICAgICAgICogQHBhcmFtIG9wdHMuYWRtaW4gLSBUcnVlIGlmIGVuZHBvaW50IHJlcXVpcmVzIGFkbWluIGFjY2Vzc1xuICAgICAgICAgKiBAcGFyYW0gb3B0cy5pZ25vcmVBdXRoXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLmNvbnRlbnRUeXBlXG4gICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBfJGh0dHAob3B0cywgY2IpIHtcbiAgICAgICAgICAgIGNiID0gY2IgfHwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIC8vIERvIG5vdGhpbmcuXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgb3B0cyA9IG1lcmdlKHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnR0VUJyxcbiAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogTUlNRS5KU09OXG4gICAgICAgICAgICB9LCBvcHRzIHx8IHt9KTtcbiAgICAgICAgICAgIHZhciBjb2VyY2VkRGF0YSA9IGNvZXJjZURhdGEob3B0cy5jb250ZW50VHlwZSwgb3B0cy5kYXRhKTtcbiAgICAgICAgICAgIGlmIChjb2VyY2VkRGF0YSAmJiBjb2VyY2VkRGF0YS5pc0Vycm9yKSB7XG4gICAgICAgICAgICAgICAgY2IoY29lcmNlZERhdGEpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb2VyY2VkRGF0YSAhPSB1bmRlZmluZWQpIG9wdHMuZGF0YSA9IGNvZXJjZWREYXRhO1xuICAgICAgICAgICAgaWYgKCFvcHRzLmlnbm9yZUF1dGgpIF9jb25maWd1cmVBdXRoKG9wdHMsIG9wdHMuYWRtaW4gPyBhZG1pbkF1dGggOiBhdXRoKTtcbiAgICAgICAgICAgIHZhciBwYXRoID0gb3B0cy5wYXRoIHx8ICcnO1xuICAgICAgICAgICAgaWYgKG9wdHMucGF0aCAhPSBudWxsKSBkZWxldGUgb3B0cy5wYXRoO1xuICAgICAgICAgICAgaWYgKCFvcHRzLnVybCkgb3B0cy51cmwgPSBfY29uc3RydWN0VVJMKHtwYXRoOiBwYXRofSk7XG4gICAgICAgICAgICBjb25zb2xlLmluZm8oJ1tDb3VjaERCOiBIVFRQIFJlcXVlc3RdOicsIG9wdHMpO1xuICAgICAgICAgICAgJC5hamF4KG9wdHMpLmRvbmUoZnVuY3Rpb24gKGRhdGEsIHRleHRTdGF0dXMsIGpxWEhSKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKCdbQ291Y2hEQjogSFRUUCBSZXNwb25zZV06Jywge1xuICAgICAgICAgICAgICAgICAgICBvcHRzOiBvcHRzLFxuICAgICAgICAgICAgICAgICAgICBqcVhIUjoganFYSFIsXG4gICAgICAgICAgICAgICAgICAgIHRleHRTdGF0dXM6IHRleHRTdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czoganFYSFIuc3RhdHVzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY2IobnVsbCwgZGF0YSwganFYSFIpO1xuICAgICAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoanFYSFIsIHRleHRTdGF0dXMsIGVycm9yVGhyb3duKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKCdbQ291Y2hEQjogSFRUUCBSZXNwb25zZV06Jywge1xuICAgICAgICAgICAgICAgICAgICBvcHRzOiBvcHRzLFxuICAgICAgICAgICAgICAgICAgICBqcVhIUjoganFYSFIsXG4gICAgICAgICAgICAgICAgICAgIHRleHRTdGF0dXM6IHRleHRTdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgIGVycm9yVGhyb3duOiBlcnJvclRocm93bixcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBqcVhIUi5zdGF0dXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3JUaHJvd24gaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBjYihuZXcgQ291Y2hFcnJvcih7dGhyb3duOiBlcnJvclRocm93bn0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiBlcnJvclRocm93biwgeGhyOiBqcVhIUiwgc3RhdHVzOiBqcVhIUi5zdGF0dXMsIG9wdHM6IG9wdHN9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogQmVzdCBlZmZvcnRzIGF0IGVuc3VyaW5nIHRoYXQgYSBzdHJpbmcgcmVwcmVzZW50cyBhIE1JTUUgdHlwZS5cbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtkYXRhVHlwZV1cbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIGVuc3VyZU1pbWVUeXBlKGRhdGFUeXBlKSB7XG4gICAgICAgICAgICBpZiAoZGF0YVR5cGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YVR5cGUudHJpbSgpID09ICdqc29uJykge1xuICAgICAgICAgICAgICAgICAgICBkYXRhVHlwZSA9IE1JTUUuSlNPTjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZGF0YVR5cGU7XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogU2VuZCBhIGh0dHAgcmVxdWVzdCB1c2luZyBub2RlLiBTaGltcyBmcm9tIGpxdWVyeSBzdHlsZSBhamF4IG9wdHNcbiAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICogQHBhcmFtIG9wdHMudHlwZVxuICAgICAgICAgKiBAcGFyYW0gW29wdHMucGF0aF1cbiAgICAgICAgICogQHBhcmFtIFtvcHRzLnVybF0gLSBpZiB1cmwgaXMgcHJlc2VudCwgcGF0aCB3aWxsIGJlIGlnbm9yZWQhXG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5jb250ZW50VHlwZV0gLSBDb250ZW50IHR5cGUgb2YgZGF0YSBiZWluZyBzZW50XG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5kYXRhVHlwZV0gLSBFeHBlY3RlZCByZXNwb25zZSB0eXBlXG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5pZ25vcmVBdXRoXVxuICAgICAgICAgKiBAcGFyYW0gb3B0cy5kYXRhIC0gTXVzdCBiZSBhIHN0cmluZyBhdCB0aGUgbW9tZW50XG4gICAgICAgICAqIEBwYXJhbSBvcHRzLmFkbWluIC0gaWYgdHJ1ZSwgd2lsbCB1c2UgY29uZmlndXJlZCBhZG1pbiBjcmVkZW50aWFsc1xuICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIF9uSHR0cChvcHRzLCBjYikge1xuICAgICAgICAgICAgY2IgPSBjYiB8fCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdmFyIHBhcnNlZFVSTDtcbiAgICAgICAgICAgIGlmIChvcHRzLnVybCkge1xuICAgICAgICAgICAgICAgIHBhcnNlZFVSTCA9IHVybC5wYXJzZShvcHRzLnVybCk7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgdGhhdCB0aGUgdXJsIHBhcmFtIHdhc250IGp1c3QgYSBwYXRoLi4uXG4gICAgICAgICAgICAgICAgaWYgKCFwYXJzZWRVUkwuaG9zdCkgcGFyc2VkVVJMID0gdXJsLnBhcnNlKF9jb25zdHJ1Y3RVUkwoe3BhdGg6IG9wdHMudXJsfSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcGFyc2VkVVJMID0gdXJsLnBhcnNlKF9jb25zdHJ1Y3RVUkwoe3BhdGg6IG9wdHMucGF0aCB8fCAnJ30pKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGF0YSA9IG9wdHMuZGF0YSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VHlwZSA9ICdjb250ZW50VHlwZScgaW4gb3B0cyA/IG9wdHMuY29udGVudFR5cGUgOiBNSU1FLkpTT04sXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VUeXBlID0gZW5zdXJlTWltZVR5cGUob3B0cy5kYXRhVHlwZSksXG4gICAgICAgICAgICAgICAgbWV0aG9kID0gb3B0cy50eXBlIHx8ICdHRVQnO1xuXG4gICAgICAgICAgICB2YXIgaHR0cE9wdHMgPSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgICAgICAgaG9zdG5hbWU6IHBhcnNlZFVSTC5ob3N0bmFtZSxcbiAgICAgICAgICAgICAgICBwb3J0OiBwYXJzZWRVUkwucG9ydCxcbiAgICAgICAgICAgICAgICBwYXRoOiBwYXJzZWRVUkwucGF0aFxuICAgICAgICAgICAgfTtcblxuXG4gICAgICAgICAgICBpZiAocmVxdWVzdFR5cGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YSkgZGF0YSA9IGNvZXJjZURhdGEocmVxdWVzdFR5cGUsIGRhdGEpO1xuICAgICAgICAgICAgICAgIGh0dHBPcHRzLmhlYWRlcnMgPSB7J2NvbnRlbnQtdHlwZSc6IHJlcXVlc3RUeXBlfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghb3B0cy5pZ25vcmVBdXRoKSBfY29uZmlndXJlQXV0aChodHRwT3B0cywgb3B0cy5hZG1pbiA/IGFkbWluQXV0aCA6IGF1dGgpO1xuICAgICAgICAgICAgdmFyIHJlcSA9IG5vZGVIdHRwLnJlcXVlc3QoaHR0cE9wdHMsIGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgICAgICAgICAvLyBPdmVycmlkZSB0byBwcmV2ZW50IGNpcmN1bGFyIEpTT04gZXJyb3JzLlxuICAgICAgICAgICAgICAgIHZhciByZXNwb25zZVN0cmluZyA9ICcnO1xuXG5cbiAgICAgICAgICAgICAgICByZXMub24oJ2RhdGEnLCBmdW5jdGlvbiAoY2h1bmspIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2VTdHJpbmcgKz0gY2h1bms7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICByZXMub24oJ2VuZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHN0YXR1c0NvZGUgPSByZXMuc3RhdHVzQ29kZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzU3VjY2VzcyA9IHN0YXR1c0NvZGUgPj0gMjAwICYmIHN0YXR1c0NvZGUgPCAzMDA7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpc1N1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBwYXJzZWRSZXNwb25zZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBfcmVzcG9uc2VUeXBlID0gKHJlc3BvbnNlVHlwZSB8fCByZXMuaGVhZGVyc1snY29udGVudC10eXBlJ10uc3BsaXQoJzsnKVswXSkudHJpbSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKF9yZXNwb25zZVR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoX3Jlc3BvbnNlVHlwZSA9PSBNSU1FLkpTT04pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlZFJlc3BvbnNlID0gSlNPTi5wYXJzZShyZXNwb25zZVN0cmluZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHt0aHJvd246IGV9KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlZFJlc3BvbnNlID0gcmVzcG9uc2VTdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZWRSZXNwb25zZSA9IHJlc3BvbnNlU3RyaW5nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY2IobnVsbCwgcGFyc2VkUmVzcG9uc2UsIHJlcyk7XG5cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHtyZXNwb25zZTogcmVzLCBzdGF0dXM6IHN0YXR1c0NvZGV9KSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoZGF0YSkgIHJlcS53cml0ZShkYXRhKTtcblxuICAgICAgICAgICAgcmVxLmVuZCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNlbmQgYSBIVFRQIHJlcXVlc3QuIFVzZXMgZWl0aGVyIGpxdWVyeSBvciBub2RlcyBodHRwIGRlcGVuZGluZyBvbiB3aGF0J3MgYXZhaWxhYmxlIGluIHRoZSBlbnZpcm9ubWVudFxuICAgICAgICAgKiBAcGFyYW0gb3B0cyAtIGpxdWVyeSBzdHlsZSBodHRwIG9wdHNcbiAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBfaHR0cChvcHRzLCBjYikge1xuICAgICAgICAgICAgaWYgKG5vZGVIdHRwKSB7XG4gICAgICAgICAgICAgICAgX25IdHRwKG9wdHMsIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIF8kaHR0cChvcHRzLCBjYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogU2VuZCBhIEhUVFAgcmVxdWVzdCBvciBtdWx0aXBsZSBodHRwIHJlcXVlc3RzIGluIHBhcmFsbGVsXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fEFycmF5fSBvcHRzIC0gVGhlIHVzdWFsIGpxdWVyeSBvcHRzLCBvciBhbiBhcnJheSBvZiB0aGVtLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW29wdHMucGF0aF0gLSBQYXRoIHRvIGFwcGVuZCB0byBob3N0XG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYl1cbiAgICAgICAgICovXG4gICAgICAgIHZhciBodHRwID0gZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvcHRzKSkge1xuICAgICAgICAgICAgICAgIF8ucGFyYWxsZWwob3B0cy5tYXAoZnVuY3Rpb24gKF9vcHRzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoZG9uZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgX2h0dHAoX29wdHMsIGRvbmUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSksIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIF9odHRwKG9wdHMsIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBIHdyYXBwZXIgYXJvdW5kIFhNTEh0dHBSZXF1ZXN0LiBUaGlzIGV4aXN0cyBkdWUgdG8gc29tZSBzaG9ydC1jb21pbmdzIGluIGpxdWVyeSBhamF4IGFyb3VuZCBibG9icy5cbiAgICAgICAgICogSWYgd2UncmUgaW4gdGhlIE5vZGUgZW52aXJvbm1lbnQsIHRoaXMgd2lsbCBzaW1wbHkgcGFzcyBvbnRvIE5vZGUuXG4gICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLm1ldGhvZFxuICAgICAgICAgKiBAcGFyYW0gb3B0cy5yZXNwb25zZVR5cGVcbiAgICAgICAgICogQHBhcmFtIG9wdHMudXJsXG4gICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIF94aHJIdHRwID0gZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kID0gb3B0cy5tZXRob2QgfHwgJ0dFVCcsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VUeXBlID0gb3B0cy5yZXNwb25zZVR5cGU7XG4gICAgICAgICAgICBjYiA9IGNiIHx8IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAobm9kZUh0dHApIHtcbiAgICAgICAgICAgICAgICAvLyBObyBuZWVkIHRvIHVzZSBYSFJcbiAgICAgICAgICAgICAgICB2YXIgbm9kZUhUVFBPcHRzID0ge1xuICAgICAgICAgICAgICAgICAgICB1cmw6IG9wdHMudXJsLFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiBtZXRob2RcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIC8vIE5vIGNvbmNlcHQgb2YgSFRNTDUgYmxvYiBpbiBOb2RlLlxuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZVR5cGUgIT0gJ2Jsb2InKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGVIVFRQT3B0c1sncmVzcG9uc2VUeXBlJ10gPSByZXNwb25zZVR5cGU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF9uSHR0cChub2RlSFRUUE9wdHMsIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHZhciBYTUxIdHRwUmVxdWVzdCA9IGdsb2JhbFsnWE1MSHR0cFJlcXVlc3QnXTtcbiAgICAgICAgICAgICAgICB2YXIgeGhyID0gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG4gICAgICAgICAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMucmVhZHlTdGF0ZSA9PSA0KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5zdGF0dXMgPT0gMjAwKSBjYihudWxsLCB0aGlzLnJlc3BvbnNlLCB4aHIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBjYih0aGlzLnN0YXR1cywgdGhpcy5yZXNwb25zZSwgeGhyKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgeGhyLm9wZW4obWV0aG9kLCBvcHRzLnVybCk7XG4gICAgICAgICAgICAgICAgaWYgKHJlc3BvbnNlVHlwZSkge1xuICAgICAgICAgICAgICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gcmVzcG9uc2VUeXBlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB4aHIuc2VuZCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBzYW1lIGFzIGh0dHAgZXhjZXB0IGRlZmF1bHQgdG8ganNvblxuICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICovXG4gICAgICAgIHZhciBqc29uID0gZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICBmdW5jdGlvbiBfanNvbihvcHRzKSB7XG4gICAgICAgICAgICAgICAgb3B0cy5kYXRhVHlwZSA9ICdqc29uJztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkob3B0cykpIHtcbiAgICAgICAgICAgICAgICBvcHRzLmZvckVhY2goX2pzb24pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgX2pzb24ob3B0cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBodHRwKG9wdHMsIGNiKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ291Y2hEQiBoYXMgYSB3ZWlyZCBjb252ZW50aW9uIGZvciB1c2VyIGlkZW50aWZpZXJzLiBUaGlzIGZ1bmN0aW9uIHNpbXBseSB0cmFuc2Zvcm1zIHRoZSB1c2VybmFtZSBpbnRvXG4gICAgICAgICAqIHRvIG1hdGNoIHRoYXQgY29udmVudGlvbi5cbiAgICAgICAgICogQHBhcmFtIHVzZXJuYW1lXG4gICAgICAgICAqIEByZXR1cm5zIHtzdHJpbmd9XG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBfZ2V0RnVsbHlRdWFsaWZlZFVzZXJuYW1lKHVzZXJuYW1lKSB7XG4gICAgICAgICAgICByZXR1cm4gJ29yZy5jb3VjaGRiLnVzZXI6JyArIHVzZXJuYW1lO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLnVzZXJuYW1lXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLnBhc3N3b3JkXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLmF1dGggLSB0aGUgYXV0aCBtZXRob2QgdG8gdXNlXG4gICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIGNyZWF0ZVVzZXIgPSBmdW5jdGlvbiAob3B0cywgY2IpIHtcbiAgICAgICAgICAgIHZhciB1c2VybmFtZSA9IG9wdHMudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgcGFzc3dvcmQgPSBvcHRzLnBhc3N3b3JkO1xuICAgICAgICAgICAgdmFyIGZ1bGx5UXVhbGlmaWVkVXNlcm5hbWUgPSBfZ2V0RnVsbHlRdWFsaWZlZFVzZXJuYW1lKHVzZXJuYW1lKTtcbiAgICAgICAgICAgIGpzb24oe1xuICAgICAgICAgICAgICAgIHBhdGg6ICdfdXNlcnMvJyArIGZ1bGx5UXVhbGlmaWVkVXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgdHlwZTogJ1BVVCcsXG4gICAgICAgICAgICAgICAgZGF0YToge1xuICAgICAgICAgICAgICAgICAgICBfaWQ6IGZ1bGx5UXVhbGlmaWVkVXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgIG5hbWU6IHVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICB0eXBlOiAndXNlcicsXG4gICAgICAgICAgICAgICAgICAgIHJvbGVzOiBbXSxcbiAgICAgICAgICAgICAgICAgICAgcGFzc3dvcmQ6IHBhc3N3b3JkXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgICAgICAgICAgIHZhciB1c2VyO1xuICAgICAgICAgICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIHVzZXIgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiB1c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiB1c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIF9pZDogcmVzcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIF9yZXY6IHJlc3AucmV2XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGlmIChvcHRzLmF1dGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcHRzLmF1dGggPT0gQVVUSF9NRVRIT0QuQkFTSUMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhdXRoID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6IEFVVEhfTUVUSE9ELkJBU0lDLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VybmFtZTogdXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBwYXNzd29yZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlcjogdXNlclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlci5wYXNzd29yZCA9IHBhc3N3b3JkO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2IobmV3IENvdWNoRXJyb3Ioe21lc3NhZ2U6ICdOWUk6IEF1dGggbWV0aG9kIFwiJyArIG9wdHMuYXV0aCArICdcIid9KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2IoZXJyLCB1c2VyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZmlyc3QgdGltZSwgYW4gYWRtaW4gdXNlciBjYW4gYmUgY3JlYXRlZCB3aXRob3V0IGFueSBwZXJtaXNzaW9ucy4gU3Vic2VxdWVudGx5LCB5b3UgbXVzdCBhdXRoZW50aWNhdGVcbiAgICAgICAgICogYXMgYW4gYW5vdGhlciBhZG1pbiB1c2VyXG4gICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAqL1xuICAgICAgICB2YXIgY3JlYXRlQWRtaW5Vc2VyID0gZnVuY3Rpb24gKGNiKSB7XG4gICAgICAgICAgICBqc29uKHtcbiAgICAgICAgICAgICAgICBwYXRoOiAnX2NvbmZpZy9hZG1pbnMvJyArIGFkbWluQXV0aC51c2VybmFtZSxcbiAgICAgICAgICAgICAgICB0eXBlOiAnUFVUJyxcbiAgICAgICAgICAgICAgICBkYXRhOiAnXCInICsgYWRtaW5BdXRoLnBhc3N3b3JkICsgJ1wiJyxcbiAgICAgICAgICAgICAgICBhZG1pbjogdHJ1ZVxuICAgICAgICAgICAgfSwgY2IpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBWZXJpZnkgdGhhdCB1c2VybmFtZS9wYXNzd29yZCBjb21iaW5hdGlvbiBpcyBjb3JyZWN0IGJ5IGhpdHRpbmcgdGhlIF9zZXNzaW9uIGVuZHBvaW50LlxuICAgICAgICAgKiBJZiB0aGlzIGlzIHRoZSBjYXNlLCBjb25maWd1cmUgZnV0dXJlIGF1dGhvcmlzYXRpb24gbWV0aG9kIGFjY29yZGluZ2x5LlxuICAgICAgICAgKiBAcGFyYW0gYXV0aE9wdHNcbiAgICAgICAgICogQHBhcmFtIGF1dGhPcHRzLnVzZXJuYW1lXG4gICAgICAgICAqIEBwYXJhbSBhdXRoT3B0cy5wYXNzd29yZFxuICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICovXG4gICAgICAgIHZhciBiYXNpY0F1dGggPSBmdW5jdGlvbiAoYXV0aE9wdHMsIGNiKSB7XG4gICAgICAgICAgICB2YXIgdXNlcm5hbWUgPSBhdXRoT3B0cy51c2VybmFtZSxcbiAgICAgICAgICAgICAgICBwYXNzd29yZCA9IGF1dGhPcHRzLnBhc3N3b3JkO1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRzID0ge1xuICAgICAgICAgICAgICAgIHBhdGg6ICdfc2Vzc2lvbicsXG4gICAgICAgICAgICAgICAgdHlwZTogJ1BPU1QnLFxuICAgICAgICAgICAgICAgIGNvbnRlbnRUeXBlOiBcImFwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZFwiLFxuICAgICAgICAgICAgICAgIGRhdGE6ICduYW1lPScgKyB1c2VybmFtZSArICcmcGFzc3dvcmQ9JyArIHBhc3N3b3JkXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAganNvbihodHRwT3B0cywgZnVuY3Rpb24gKGVyciwgZGF0YSkge1xuICAgICAgICAgICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChkYXRhLm9rKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhdXRoID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1ldGhvZDogQVVUSF9NRVRIT0QuQkFTSUMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IHVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBwYXNzd29yZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1c2VyOiBkYXRhXG4gICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS51c2VybmFtZSA9IHVzZXJuYW1lO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS5wYXNzd29yZCA9IHBhc3N3b3JkO1xuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YS5uYW1lID0gdXNlcm5hbWU7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYihudWxsLCBkYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKGRhdGEpKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcblxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBZG1pbiB1c2VycyBhcmUgZGlmZmVyZW50IHdpdGggQ291Y2hEQiBhbmQgZG9uJ3QgZXhpc3QgdW5kZXIgdGhlIG5vcm1hbCBfdXNlcnMgZGF0YWJhc2UuXG4gICAgICAgICAqIEBwYXJhbSBbYXV0aE9wdHNdXG4gICAgICAgICAqIEBwYXJhbSBbYXV0aE9wdHMudXNlcm5hbWVdXG4gICAgICAgICAqIEBwYXJhbSBbYXV0aE9wdHMucGFzc3dvcmRdXG4gICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIGFkbWluTG9naW4gPSBmdW5jdGlvbiAoYXV0aE9wdHMsIGNiKSB7XG4gICAgICAgICAgICAvLyBPbmx5IGFkbWlucyBjYW4gcmVhZCBnbG9iYWwgY29uZmlnLCB0aGVyZWZvcmUgd2UgdGVzdCB0aGF0IGNyZWRlbnRpYWxzIGFyZSBjb3JyZWN0IGJ5IHF1ZXJ5aW5nIHRoYXRcbiAgICAgICAgICAgIC8vIGRhdGFiYXNlLlxuICAgICAgICAgICAganNvbih7XG4gICAgICAgICAgICAgICAgcGF0aDogJ19jb25maWcnXG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgYWRtaW5BdXRoID0gbWVyZ2Uoe30sIGF1dGhPcHRzKTtcbiAgICAgICAgICAgICAgICAgICAgYWRtaW5BdXRoLm1ldGhvZCA9IEFVVEhfTUVUSE9ELkJBU0lDO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgZnVuY3Rpb24gb3B0c09yQ2FsbGJhY2sob3B0c09yQ2IsIGNiKSB7XG4gICAgICAgICAgICB2YXIgb3B0cztcbiAgICAgICAgICAgIGlmIChvcHRzT3JDYiBpbnN0YW5jZW9mIEZ1bmN0aW9uKSB7XG4gICAgICAgICAgICAgICAgY2IgPSBvcHRzT3JDYjtcbiAgICAgICAgICAgICAgICBvcHRzID0ge307XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBvcHRzID0gb3B0c09yQ2I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge29wdHM6IG9wdHMsIGNiOiBjYn07XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogUHVibGljIEFQSSBwcm92aWRpbmcgYWNjZXNzIHRvIHRoZSBiYWNraW5nIENvdWNoREIgaW5zdGFuY2UuXG4gICAgICAgICAqL1xuICAgICAgICB2YXIgQVBJO1xuICAgICAgICAvL25vaW5zcGVjdGlvbiBKU0NvbW1lbnRNYXRjaGVzU2lnbmF0dXJlLEpTQ29tbWVudE1hdGNoZXNTaWduYXR1cmUsSlNWYWxpZGF0ZUpTRG9jXG4gICAgICAgIEFQSSA9IHtcbiAgICAgICAgICAgIGluZm86IGZ1bmN0aW9uIChjYikge1xuICAgICAgICAgICAgICAgIGpzb24oe3BhdGg6ICcnfSwgY2IpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGNyZWF0ZVVzZXI6IGNyZWF0ZVVzZXIsXG4gICAgICAgICAgICBiYXNpY0F1dGg6IGJhc2ljQXV0aCxcbiAgICAgICAgICAgIGFkbWluTG9naW46IGFkbWluTG9naW4sXG4gICAgICAgICAgICBsb2dvdXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICBhdXRoID0gbnVsbDtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBhZG1pbjoge1xuICAgICAgICAgICAgICAgIGNyZWF0ZUFkbWluVXNlcjogY3JlYXRlQWRtaW5Vc2VyLFxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICAqIENsZWFyIG91dCB0aGUgZGF0YWJhc2UuIFVzZWZ1bCBkdXJpbmcgdGVzdGluZy5cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIGRlbGV0ZUFsbERhdGFiYXNlczogZnVuY3Rpb24gKG9wdHNPckNiLCBjYikge1xuICAgICAgICAgICAgICAgICAgICB2YXIgX19yZXQgPSBvcHRzT3JDYWxsYmFjayhvcHRzT3JDYiwgY2IpLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3B0cyA9IF9fcmV0Lm9wdHM7XG4gICAgICAgICAgICAgICAgICAgIGNiID0gX19yZXQuY2I7XG4gICAgICAgICAgICAgICAgICAgIG9wdHMucGF0aCA9ICdfYWxsX2Ricyc7XG4gICAgICAgICAgICAgICAgICAgIG9wdHMuYWRtaW4gPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICBqc29uKG9wdHMsIGZ1bmN0aW9uIChlcnIsIGRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnIpIGNiKGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgYWpheE9wdHMgPSBkYXRhLnJlZHVjZShmdW5jdGlvbiAobWVtbywgZGJOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghSUdOT1JFX0RBVEFCQVNFUy5tZW1iZXJPZihkYk5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZW1vLnB1c2goe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdERUxFVEUnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IGRiTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhZG1pbjogdHJ1ZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG1lbW87XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgW10pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGpzb24oYWpheE9wdHMsIGNiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIGRvY1xuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuaWRcbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMucmVtb3ZlXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy5hZG1pbl1cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMuZGF0YWJhc2VdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBfdG9nZ2xlRG9jOiBmdW5jdGlvbiAoZG9jLCBvcHRzLCBjYikge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YWJhc2UgPSBvcHRzLmRhdGFiYXNlIHx8IGRlZmF1bHREQixcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkID0gb3B0cy5pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlbW92ZSA9IG9wdHMucmVtb3ZlO1xuICAgICAgICAgICAgICAgICAgICB2YXIgcGF0aCA9IGRhdGFiYXNlICsgJy8nICsgaWQ7XG4gICAgICAgICAgICAgICAgICAgIGpzb24obWVyZ2UodHJ1ZSwgb3B0cywge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgIGFkbWluOiBvcHRzLmFkbWluXG4gICAgICAgICAgICAgICAgICAgIH0pLCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgZm91bmQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnIuc3RhdHVzID09IEFQSS5IVFRQX1NUQVRVUy5OT1RfRk9VTkQpIGZvdW5kID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKGVycik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAocmVtb3ZlICYmIGZvdW5kKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gZGVsZXRlIGl0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCArPSAnP3Jldj0nICsgcmVzcC5fcmV2O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGpzb24obWVyZ2UodHJ1ZSwgb3B0cywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnREVMRVRFJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRtaW46IG9wdHMuYWRtaW5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSwgY2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSBpZiAoIXJlbW92ZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGNyZWF0ZSBvciB1cGRhdGUgaXRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmQpIGRvYy5fcmV2ID0gcmVzcC5fcmV2O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGpzb24obWVyZ2UodHJ1ZSwgb3B0cywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnUFVUJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogZG9jLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhZG1pbjogb3B0cy5hZG1pblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pLCBjYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBOb3RoaW5nIHRvIGRvIVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKG51bGwsIHJlc3ApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKiBDbGVhciBvdXQgdGhlIGRhdGFiYXNlLiBVc2VmdWwgZHVyaW5nIHRlc3RpbmcuXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYl1cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiLnVzZXJuYW1lXSAtIGFkbWluIHVzZXJuYW1lXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi5wYXNzd29yZF0gLSBhZG1pbiBwYXNzd29yZFxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIHJlc2V0OiBmdW5jdGlvbiAob3B0c09yQ2IsIGNiKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBfX3JldCA9IG9wdHNPckNhbGxiYWNrKG9wdHNPckNiLCBjYiksXG4gICAgICAgICAgICAgICAgICAgICAgICBvcHRzID0gX19yZXQub3B0cztcbiAgICAgICAgICAgICAgICAgICAgY2IgPSBfX3JldC5jYjtcbiAgICAgICAgICAgICAgICAgICAgQVBJLmFkbWluLmRlbGV0ZUFsbERhdGFiYXNlcyhvcHRzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWVycikgQVBJLmxvZ291dCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy5hbm9ueW1vdXNVcGRhdGVzXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy5hbm9ueW1vdXNSZWFkc11cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW2NiXVxuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIGNvbmZpZ3VyZURhdGFiYXNlOiBmdW5jdGlvbiAob3B0cywgY2IpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHRhc2tzID0gW107XG4gICAgICAgICAgICAgICAgICAgIGlmIChvcHRzLmFub255bW91c1VwZGF0ZXMgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0YXNrcy5wdXNoKGZ1bmN0aW9uIChkb25lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGRvYyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGFuZ3VhZ2U6ICdqYXZhc2NyaXB0JyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFsaWRhdGVfZG9jX3VwZGF0ZTogZnVuY3Rpb24gKG5ld19kb2MsIG9sZF9kb2MsIHVzZXJDdHgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdXNlckN0eC5uYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3coe2ZvcmJpZGRlbjogXCJOb3QgQXV0aG9yaXplZFwifSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0udG9TdHJpbmcoKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgQVBJLmFkbWluLl90b2dnbGVEb2MoZG9jLCB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlkOiAnX2Rlc2lnbi9ibG9ja0Fub255bW91c1VwZGF0ZXMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZW1vdmU6IG9wdHMuYW5vbnltb3VzVXBkYXRlcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRtaW46IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LCBkb25lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmIChvcHRzLmFub255bW91c1JlYWRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGFza3MucHVzaChmdW5jdGlvbiAoZG9uZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBkb2MgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhbmd1YWdlOiAnamF2YXNjcmlwdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRlX2RvY19yZWFkOiBmdW5jdGlvbiAoZG9jLCB1c2VyQ3R4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXVzZXJDdHgubmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93KHtmb3JiaWRkZW46IFwiTm90IEF1dGhvcml6ZWRcIn0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LnRvU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFQSS5hZG1pbi5fdG9nZ2xlRG9jKGRvYywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZDogJ19kZXNpZ24vYmxvY2tBbm9ueW1vdXNSZWFkcycsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlbW92ZTogb3B0cy5hbm9ueW1vdXNSZWFkcyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRtaW46IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LCBkb25lKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIF8ucGFyYWxsZWwodGFza3MsIGNiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLCAvKipcbiAgICAgICAgICAgICAgICAgKlxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2JdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi5kYXRhYmFzZV1cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiLmFub255bW91c1VwZGF0ZXNdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi5hbm9ueW1vdXNSZWFkc11cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW2NiXVxuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIGNyZWF0ZURhdGFiYXNlOiBmdW5jdGlvbiAob3B0c09yQ2IsIGNiKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBfX3JldCA9IG9wdHNPckNhbGxiYWNrKG9wdHNPckNiLCBjYik7XG4gICAgICAgICAgICAgICAgICAgIHZhciBvcHRzID0gX19yZXQub3B0cztcbiAgICAgICAgICAgICAgICAgICAgY2IgPSBfX3JldC5jYjtcbiAgICAgICAgICAgICAgICAgICAgb3B0cy5wYXRoID0gb3B0cy5kYXRhYmFzZSB8fCBkZWZhdWx0REI7XG4gICAgICAgICAgICAgICAgICAgIG9wdHMudHlwZSA9ICdQVVQnO1xuICAgICAgICAgICAgICAgICAgICBvcHRzLmFkbWluID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAganNvbihvcHRzLCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoIWVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuY29uZmlndXJlRGF0YWJhc2Uob3B0cywgY2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGNiKGVycik7XG4gICAgICAgICAgICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICxcblxuICAgICAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2JdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi5kYXRhYmFzZV1cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW2NiXVxuICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgIGdldFBlcm1pc3Npb25zOiBmdW5jdGlvbiAob3B0c09yQ2IsIGNiKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciBfX3JldCA9IG9wdHNPckNhbGxiYWNrKG9wdHNPckNiLCBjYik7XG4gICAgICAgICAgICAgICAgICAgIHZhciBvcHRzID0gX19yZXQub3B0cztcbiAgICAgICAgICAgICAgICAgICAgY2IgPSBfX3JldC5jYjtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGFiYXNlID0gb3B0cy5kYXRhYmFzZSB8fCBkZWZhdWx0REI7XG4gICAgICAgICAgICAgICAgICAgIG9wdHMucGF0aCA9IGRhdGFiYXNlICsgJy9fc2VjdXJpdHknO1xuICAgICAgICAgICAgICAgICAgICBvcHRzLmFkbWluID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAganNvbihvcHRzLCBjYik7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgSFRUUF9TVEFUVVM6IHtcbiAgICAgICAgICAgICAgICBVTkFVVEhPUklTRUQ6IDQwMSxcbiAgICAgICAgICAgICAgICBDT05GTElDVDogNDA5LFxuICAgICAgICAgICAgICAgIE5PVF9GT1VORDogNDA0LFxuICAgICAgICAgICAgICAgIEZPUkJJRERFTjogNDAzXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgQVVUSF9NRVRIT0Q6IEFVVEhfTUVUSE9ELFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBWZXJpZnkgdGhhdCB0aGUgY29uZmlndXJhdGlvbiBpcyBvay5cbiAgICAgICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICB2ZXJpZnk6IGZ1bmN0aW9uIChjYikge1xuICAgICAgICAgICAgICAgIGpzb24oe1xuICAgICAgICAgICAgICAgICAgICBwYXRoOiBkZWZhdWx0REJcbiAgICAgICAgICAgICAgICB9LCBjYik7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICBfdXBzZXJ0RG9jdW1lbnRBcmd1bWVudHM6IGZ1bmN0aW9uIChhcmd1bWVudHMpIHtcbiAgICAgICAgICAgICAgICB2YXIgZG9jLCBvcHRzLCBjYjtcbiAgICAgICAgICAgICAgICBpZiAoaXNPYmplY3QoYXJndW1lbnRzWzBdKSAmJiBpc09iamVjdChhcmd1bWVudHNbMV0pKSB7XG4gICAgICAgICAgICAgICAgICAgIGRvYyA9IGFyZ3VtZW50c1swXTtcbiAgICAgICAgICAgICAgICAgICAgb3B0cyA9IGFyZ3VtZW50c1sxXTtcbiAgICAgICAgICAgICAgICAgICAgY2IgPSBhcmd1bWVudHNbMl07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGlzT2JqZWN0KGFyZ3VtZW50c1swXSkpIHtcbiAgICAgICAgICAgICAgICAgICAgZG9jID0gYXJndW1lbnRzWzBdO1xuICAgICAgICAgICAgICAgICAgICBvcHRzID0ge307XG4gICAgICAgICAgICAgICAgICAgIGNiID0gYXJndW1lbnRzWzFdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgZG9jID0ge307XG4gICAgICAgICAgICAgICAgICAgIG9wdHMgPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgY2IgPSBhcmd1bWVudHNbMF07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNiID0gY2IgfHwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtkb2M6IGRvYywgb3B0czogb3B0cywgY2I6IGNifTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIFVwZGF0ZXMgc3BlY2lhbCBmaWVsZHMgaW4gdGhlIGNvdWNoZGIgZG9jIGdpdmVuIGEgcmVzcG9uc2UgZnJvbSBjb3VjaGRiLlxuICAgICAgICAgICAgICogQHBhcmFtIGRvY1xuICAgICAgICAgICAgICogQHBhcmFtIHJlc3BcbiAgICAgICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAgICAgKiBAcmV0dXJucyB7c3RyaW5nfHVuZGVmaW5lZH0gLSB2YWxpZGF0aW9uIGVycm9yIGlmIGFwcHJvcHJpYXRlXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIF91cGRhdGVEb2NXaXRoUmVzcG9uc2U6IGZ1bmN0aW9uIChkb2MsIHJlc3ApIHtcbiAgICAgICAgICAgICAgICB2YXIgbmV3aWQgPSByZXNwLmlkLFxuICAgICAgICAgICAgICAgICAgICBuZXdyZXYgPSByZXNwLnJldjtcbiAgICAgICAgICAgICAgICBpZiAoIW5ld2lkKSByZXR1cm4gJ05vIGlkIGluIHJlc3BvbnNlJztcbiAgICAgICAgICAgICAgICBpZiAoIW5ld3JldikgcmV0dXJuICdObyByZXYgaW4gcmVzcG9uc2UnO1xuICAgICAgICAgICAgICAgIGRvYy5faWQgPSBuZXdpZDtcbiAgICAgICAgICAgICAgICBkb2MuX3JldiA9IG5ld3JldjtcbiAgICAgICAgICAgIH0sIC8qKlxuICAgICAgICAgICAgICogQ3JlYXRlcyBvciB1cGRhdGVzIGEgZG9jdW1lbnQuIFVzZXMgUFVUL1BPU1QgYXBwcm9wcmlhdGVseS5cbiAgICAgICAgICAgICAqIEBwYXJhbSBbZG9jXVxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzXVxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLm1lcmdlXSAtIElmIHJldmlzaW9uIGRvZXNuJ3QgbWF0Y2gsIGF1dG9tYXRpY2FsbHkgbWVyZ2UgdGhlIGRvY3VtZW50LlxuICAgICAgICAgICAgICogQHBhcmFtIFtjYl1cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgdXBzZXJ0RG9jdW1lbnQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgYXJncyA9IHRoaXMuX3Vwc2VydERvY3VtZW50QXJndW1lbnRzKGFyZ3VtZW50cyksXG4gICAgICAgICAgICAgICAgICAgIGRvYyA9IGFyZ3MuZG9jLFxuICAgICAgICAgICAgICAgICAgICBvcHRzID0gYXJncy5vcHRzLFxuICAgICAgICAgICAgICAgICAgICBjYiA9IGFyZ3MuY2IsXG4gICAgICAgICAgICAgICAgICAgIGlkLCBwYXRoO1xuICAgICAgICAgICAgICAgIGlmIChkb2MuX2lkKSB7XG4gICAgICAgICAgICAgICAgICAgIGlkID0gZG9jLl9pZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcGF0aCA9IG9wdHMuZGIgfHwgZGVmYXVsdERCO1xuICAgICAgICAgICAgICAgIGlmIChpZCkgcGF0aCArPSAnLycgKyBpZDtcbiAgICAgICAgICAgICAgICBpZiAoYXV0aCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoJ3VzZXInIGluIGRvYykge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2IobmV3IENvdWNoRXJyb3Ioe21lc3NhZ2U6ICd0aGUgdXNlciBmaWVsZCBpcyByZXNlcnZlZCd9KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZG9jLnVzZXIgPSBhdXRoLnVzZXIubmFtZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAganNvbih7XG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgICAgIGRhdGE6IGRvYyxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogaWQgPyAnUFVUJyA6ICdQT1NUJ1xuICAgICAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBwcm9jZXNzZWREb2MgPSBtZXJnZSh7fSwgZG9jKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVyciA9IHRoaXMuX3VwZGF0ZURvY1dpdGhSZXNwb25zZShwcm9jZXNzZWREb2MsIHJlc3ApO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2IoZXJyLCBwcm9jZXNzZWREb2MsIHJlc3ApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGlzQ29uZmxpY3QgPSBlcnIuc3RhdHVzID09IEFQSS5IVFRQX1NUQVRVUy5DT05GTElDVCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaG91bGRNZXJnZSA9IG9wdHMuY29uZmxpY3RzID09ICdtZXJnZSc7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoc2hvdWxkTWVyZ2UgJiYgaXNDb25mbGljdCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFQSS5fbWVyZ2UoZG9jLCBvcHRzLCBjYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgICAgICAgIH0sXG5cblxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBXaWxsIHJlcGVhdGVkbHkgaGl0IENvdWNoREIgdW50aWwgZG9jIGhhcyBiZWVuIG1lcmdlZCAoZS5nLiBubyBjb25mbGljdClcbiAgICAgICAgICAgICAqIEBwYXJhbSBkb2NcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIF9tZXJnZTogZnVuY3Rpb24gKGRvYywgb3B0cywgY2IpIHtcbiAgICAgICAgICAgICAgICBBUEkuZ2V0RG9jdW1lbnQoZG9jLl9pZCwgb3B0cywgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgZGVsZXRlIGRvYy5fcmV2O1xuICAgICAgICAgICAgICAgICAgICAgICAgZG9jID0gbWVyZ2UocmVzcCwgZG9jKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFRyeSBhZ2FpbiBub3cgdGhhdCBfcmV2IHNob3VsZCBiZSB1cGRhdGVkLlxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cHNlcnREb2N1bWVudChkb2MsIG9wdHMsIGNiKTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGNiKGVycik7XG4gICAgICAgICAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogR2V0IGRvY3VtZW50IHdpdGggaWRcbiAgICAgICAgICAgICAqIEBwYXJhbSBfaWRcbiAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2JdXG4gICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiLmRhdGFiYXNlXVxuICAgICAgICAgICAgICogQHBhcmFtIFtjYl1cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZ2V0RG9jdW1lbnQ6IGZ1bmN0aW9uIChfaWQsIG9wdHNPckNiLCBjYikge1xuICAgICAgICAgICAgICAgIHZhciBfX3JldCA9IG9wdHNPckNhbGxiYWNrKG9wdHNPckNiLCBjYiksXG4gICAgICAgICAgICAgICAgICAgIG9wdHMgPSBfX3JldC5vcHRzO1xuICAgICAgICAgICAgICAgIGNiID0gX19yZXQuY2I7XG4gICAgICAgICAgICAgICAgdmFyIGRhdGFiYXNlID0gb3B0cy5kYXRhYmFzZSB8fCBkZWZhdWx0REI7XG4gICAgICAgICAgICAgICAganNvbih7XG4gICAgICAgICAgICAgICAgICAgIHBhdGg6IGRhdGFiYXNlICsgJy8nICsgX2lkXG4gICAgICAgICAgICAgICAgfSwgY2IpO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgZ2V0VXNlcjogZnVuY3Rpb24gKHVzZXJuYW1lLCBjYikge1xuICAgICAgICAgICAgICAgIHZhciBmdWxseVF1YWxpZmllZFVzZXJuYW1lID0gX2dldEZ1bGx5UXVhbGlmZWRVc2VybmFtZSh1c2VybmFtZSk7XG4gICAgICAgICAgICAgICAganNvbih7XG4gICAgICAgICAgICAgICAgICAgIHBhdGg6ICdfdXNlcnMvJyArIGZ1bGx5UXVhbGlmaWVkVXNlcm5hbWVcbiAgICAgICAgICAgICAgICB9LCBjYik7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuZG9jIC0gYSBkb2N1bWVudCB3aXRoIF9pZCBvciBhbiBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgX2lkXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0cy5hdHROYW1lIC0gbmFtZSBvZiB0aGUgYXR0YWNobWVudFxuICAgICAgICAgICAgICogQHBhcmFtIFtjYl1cbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgZ2V0QXR0YWNobWVudDogZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRhdGFiYXNlID0gb3B0cy5kYiB8fCBkZWZhdWx0REIsXG4gICAgICAgICAgICAgICAgICAgIGlkID0gaXNTdHJpbmcob3B0cy5kb2MpID8gb3B0cy5kb2MgOiBvcHRzLmRvYy5faWQsXG4gICAgICAgICAgICAgICAgICAgIHBhdGggPSBkYXRhYmFzZSArICcvJyArIGlkICsgJy8nICsgb3B0cy5hdHROYW1lO1xuICAgICAgICAgICAgICAgIGh0dHAoe1xuICAgICAgICAgICAgICAgICAgICBwYXRoOiBwYXRoLFxuICAgICAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogbnVsbFxuICAgICAgICAgICAgICAgIH0sIGNiKTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICpcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0cy5kb2MgLSBhIGRvY3VtZW50IHdpdGggX2lkIG9yIGFuIHN0cmluZyByZXByZXNlbnRhdGlvbiBvZiBfaWRcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLmF0dE5hbWUgLSBuYW1lIG9mIHRoZSBhdHRhY2htZW50XG4gICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMuZGJdXG4gICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMuZGF0YV0gLSByYXcgYnl0ZXMgdG8gcHVzaFxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLnVybF0gLSBhamF4IG9wdGlvbnMgdG8gZ2V0IGRhdGFcbiAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy5taW1lVHlwZV0gLSByZXF1aXJlZCBpZiB1c2UgZGF0YSBwYXJhbWV0ZXJcbiAgICAgICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIHB1dEF0dGFjaG1lbnQ6IGZ1bmN0aW9uIChvcHRzLCBjYikge1xuICAgICAgICAgICAgICAgIGNiID0gY2IgfHwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgaWYgKG9wdHMuZGF0YSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXNzZXJ0T3B0aW9ucyhbJ2RhdGEnLCAnbWltZVR5cGUnLCAnYXR0TmFtZScsICdkb2MnXSwgb3B0cywgY2IpLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YWJhc2UgPSBvcHRzLmRiIHx8IGRlZmF1bHREQixcbiAgICAgICAgICAgICAgICAgICAgICAgIGlkID0gaXNTdHJpbmcob3B0cy5kb2MpID8gb3B0cy5kb2MgOiBvcHRzLmRvYy5faWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBtaW1lVHlwZSA9IG9wdHMubWltZVR5cGUgfHwgZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXYgPSBvcHRzLmRvYy5fcmV2LFxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCA9IGRhdGFiYXNlICsgJy8nICsgaWQgKyAnLycgKyBvcHRzLmF0dE5hbWU7XG4gICAgICAgICAgICAgICAgICAgIGlmIChyZXYpIHBhdGggKz0gJz9yZXY9JyArIHJldjtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGhlYWRlcnMgPSBvcHRzLmhlYWRlcnMgfHwge307XG4gICAgICAgICAgICAgICAgICAgIC8vaGVhZGVyc1snQ29udGVudC1UeXBlJ10gPSBtaW1lVHlwZTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGh0dHBPcHRzID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdQVVQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogb3B0cy5kYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgY2FjaGU6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc0RhdGE6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGVudFR5cGU6IG1pbWVUeXBlXG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGh0dHBPcHRzLmhlYWRlcnMgPSBoZWFkZXJzO1xuICAgICAgICAgICAgICAgICAgICBodHRwKGh0dHBPcHRzLCBjYik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKG9wdHMudXJsKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChhc3NlcnRPcHRpb25zKFsndXJsJywgJ2F0dE5hbWUnLCAnZG9jJ10sIG9wdHMsIGNiKS5sZW5ndGgpIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgLypcbiAgICAgICAgICAgICAgICAgICAgIGpxdWVyeSBhamF4IGRvZXMgbm90IHN1cHBvcnQgYmxvYnNcbiAgICAgICAgICAgICAgICAgICAgIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9xdWVzdGlvbnMvMTc2NTcxODQvdXNpbmctanF1ZXJ5cy1hamF4LW1ldGhvZC10by1yZXRyaWV2ZS1pbWFnZXMtYXMtYS1ibG9iXG4gICAgICAgICAgICAgICAgICAgICBldmVuIGlmIG5vdCB1c2luZyBibG9iIGtlcHQgZXhwZXJpZW5jaW5nIGlzc3VlcyB3aXRoIGNvcnJ1cHRpb24gb2YgaW1hZ2UgZGF0YS5cbiAgICAgICAgICAgICAgICAgICAgIEl0J3MgcHJvYmFibHkgc29tZXRoaW5nIHRvIGRvIHdpdGggZW5jb2RpbmcgYnV0IHdpbGwgWEhSIGZvciB0aGlzIGZvciBub3cuXG4gICAgICAgICAgICAgICAgICAgICBUT0RPOiBVc2UganF1ZXJ5IGluc3RlYWQgZm9yIHRoZSBiZWxvdyAoaWYgcG9zc2libGUpXG4gICAgICAgICAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgICAgICAgICBfeGhySHR0cCh7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgdXJsOiBvcHRzLnVybCxcbiAgICAgICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlVHlwZTogJ2Jsb2InXG4gICAgICAgICAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnJTdGF0dXMsIGRhdGEsIHhocikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFlcnJTdGF0dXMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgZGF0YWJhc2UgPSBvcHRzLmRiIHx8IGRlZmF1bHREQixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWQgPSBpc1N0cmluZyhvcHRzLmRvYykgPyBvcHRzLmRvYyA6IG9wdHMuZG9jLl9pZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV2ID0gb3B0cy5kb2MuX3JldixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWltZVR5cGUgPSBvcHRzLm1pbWVUeXBlIHx8IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoID0gZGF0YWJhc2UgKyAnLycgKyBpZCArICcvJyArIG9wdHMuYXR0TmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocmV2KSBwYXRoICs9ICc/cmV2PScgKyByZXY7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaHR0cCh7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHR5cGU6ICdQVVQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBkYXRhLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzRGF0YTogZmFsc2UsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnRUeXBlOiBtaW1lVHlwZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIGNiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHt4aHI6IHhociwgc3RhdHVzOiBlcnJTdGF0dXN9KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgY2IobmV3IENvdWNoRXJyb3Ioe21lc3NhZ2U6ICdNdXN0IHNwZWNpZnkgZWl0aGVyIGRhdGEgb3IgYWpheCd9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKlxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLmRhdGFcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLm1pbWVUeXBlLFxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuYXR0TmFtZVxuICAgICAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNvbnN0cnVjdEF0dGFjaG1lbnRGcm9tUmF3RGF0YTogZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICAgICAgdmFyIGF0dGFjaG1lbnQgPSB7fTtcbiAgICAgICAgICAgICAgICBhdHRhY2htZW50W29wdHMuYXR0TmFtZV0gPSB7XG4gICAgICAgICAgICAgICAgICAgICdjb250ZW50LXR5cGUnOiBvcHRzLm1pbWVUeXBlLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBidG9hKGRhdGEpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICBjYihudWxsLCBhdHRhY2htZW50KVxuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKlxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICAgICAqIEBwYXJhbSB7QmxvYn0gb3B0cy5kYXRhIC0gYmxvYlxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMubWltZVR5cGUsXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0cy5hdHROYW1lXG4gICAgICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgY29uc3RydWN0QXR0YWNobWVudEZyb21CbG9iOiBmdW5jdGlvbiAob3B0cywgY2IpIHtcbiAgICAgICAgICAgICAgICB2YXIgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcbiAgICAgICAgICAgICAgICByZWFkZXIub25sb2FkZW5kID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgYjY0ID0gcmVhZGVyLnJlc3VsdDtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGF0dGFjaG1lbnQgPSB7fTtcbiAgICAgICAgICAgICAgICAgICAgYXR0YWNobWVudFtvcHRzLmF0dE5hbWVdID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2NvbnRlbnQtdHlwZSc6IG9wdHMubWltZVR5cGUsXG4gICAgICAgICAgICAgICAgICAgICAgICBkYXRhOiBiNjRcbiAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgY2IobnVsbCwgYXR0YWNobWVudCk7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZWFkZXIub25lcnJvciA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHJlYWRlci5yZWFkQXNEYXRhVVJMKG9wdHMuZGF0YSk7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKlxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRzLnVybCAtIGEgdXJsIHRvIHNvbWV0aGluZ1xuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuYXR0TmFtZVxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLm1pbWVUeXBlXVxuICAgICAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNvbnN0cnVjdEF0dGFjaG1lbnRGcm9tVVJMOiBmdW5jdGlvbiAob3B0cywgY2IpIHtcbiAgICAgICAgICAgICAgICBfeGhySHR0cCh7XG4gICAgICAgICAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICAgICAgICAgIHJlc3BvbnNlVHlwZTogJ2Jsb2InLFxuICAgICAgICAgICAgICAgICAgICB1cmw6IG9wdHMudXJsXG4gICAgICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVyclN0YXR1cywgZGF0YSwgeGhyKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXJyU3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBvcHRzLmRhdGEgPSBkYXRhOyAvLyByZXNwb25zZSBpcyBhIEJsb2Igb2JqZWN0LlxuICAgICAgICAgICAgICAgICAgICAgICAgQVBJLmNvbnN0cnVjdEF0dGFjaG1lbnRGcm9tQmxvYihvcHRzLCBjYik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYihuZXcgQ291Y2hFcnJvcih7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0Vycm9yIGdldHRpbmcgYXR0YWNobWVudCBmcm9tIFVSTDogJyArIG9wdHMudXJsLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHhocjogeGhyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN0YXR1czogZXJyU3RhdHVzXG4gICAgICAgICAgICAgICAgICAgICAgICB9KSlcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShBUEksICdhdXRoJywge1xuICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF1dGg7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2V0OiBmdW5jdGlvbiAoX2F1dGgpIHtcbiAgICAgICAgICAgICAgICBhdXRoID0gX2F1dGhcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IGZhbHNlLFxuICAgICAgICAgICAgZW51bWVyYWJsZTogdHJ1ZVxuICAgICAgICB9KTtcblxuXG4gICAgICAgIHJldHVybiBBUEk7XG5cbiAgICB9O1xuXG4gICAgcm9vdC5jb3VjaGRiID0gY291Y2hkYjtcblxufSkodGhpcyk7IiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuXG52YXIgYmFzZTY0ID0gcmVxdWlyZSgnYmFzZTY0LWpzJylcbnZhciBpZWVlNzU0ID0gcmVxdWlyZSgnaWVlZTc1NCcpXG52YXIgaXNBcnJheSA9IHJlcXVpcmUoJ2lzLWFycmF5JylcblxuZXhwb3J0cy5CdWZmZXIgPSBCdWZmZXJcbmV4cG9ydHMuU2xvd0J1ZmZlciA9IFNsb3dCdWZmZXJcbmV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMgPSA1MFxuQnVmZmVyLnBvb2xTaXplID0gODE5MiAvLyBub3QgdXNlZCBieSB0aGlzIGltcGxlbWVudGF0aW9uXG5cbnZhciBrTWF4TGVuZ3RoID0gMHgzZmZmZmZmZlxudmFyIHJvb3RQYXJlbnQgPSB7fVxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqIC0gSW1wbGVtZW50YXRpb24gbXVzdCBzdXBwb3J0IGFkZGluZyBuZXcgcHJvcGVydGllcyB0byBgVWludDhBcnJheWAgaW5zdGFuY2VzLlxuICogICBGaXJlZm94IDQtMjkgbGFja2VkIHN1cHBvcnQsIGZpeGVkIGluIEZpcmVmb3ggMzArLlxuICogICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTY5NTQzOC5cbiAqXG4gKiAgLSBDaHJvbWUgOS0xMCBpcyBtaXNzaW5nIHRoZSBgVHlwZWRBcnJheS5wcm90b3R5cGUuc3ViYXJyYXlgIGZ1bmN0aW9uLlxuICpcbiAqICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgIGluY29ycmVjdCBsZW5ndGggaW4gc29tZSBzaXR1YXRpb25zLlxuICpcbiAqIFdlIGRldGVjdCB0aGVzZSBidWdneSBicm93c2VycyBhbmQgc2V0IGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGAgdG8gYGZhbHNlYCBzbyB0aGV5IHdpbGxcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IHdpbGwgd29yayBjb3JyZWN0bHkuXG4gKi9cbkJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUID0gKGZ1bmN0aW9uICgpIHtcbiAgdHJ5IHtcbiAgICB2YXIgYnVmID0gbmV3IEFycmF5QnVmZmVyKDApXG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIHJldHVybiA0MiA9PT0gYXJyLmZvbygpICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgJiYgLy8gY2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gICAgICAgIG5ldyBVaW50OEFycmF5KDEpLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59KSgpXG5cbi8qKlxuICogQ2xhc3M6IEJ1ZmZlclxuICogPT09PT09PT09PT09PVxuICpcbiAqIFRoZSBCdWZmZXIgY29uc3RydWN0b3IgcmV0dXJucyBpbnN0YW5jZXMgb2YgYFVpbnQ4QXJyYXlgIHRoYXQgYXJlIGF1Z21lbnRlZFxuICogd2l0aCBmdW5jdGlvbiBwcm9wZXJ0aWVzIGZvciBhbGwgdGhlIG5vZGUgYEJ1ZmZlcmAgQVBJIGZ1bmN0aW9ucy4gV2UgdXNlXG4gKiBgVWludDhBcnJheWAgc28gdGhhdCBzcXVhcmUgYnJhY2tldCBub3RhdGlvbiB3b3JrcyBhcyBleHBlY3RlZCAtLSBpdCByZXR1cm5zXG4gKiBhIHNpbmdsZSBvY3RldC5cbiAqXG4gKiBCeSBhdWdtZW50aW5nIHRoZSBpbnN0YW5jZXMsIHdlIGNhbiBhdm9pZCBtb2RpZnlpbmcgdGhlIGBVaW50OEFycmF5YFxuICogcHJvdG90eXBlLlxuICovXG5mdW5jdGlvbiBCdWZmZXIgKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpXG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybylcblxuICB2YXIgdHlwZSA9IHR5cGVvZiBzdWJqZWN0XG5cbiAgLy8gRmluZCB0aGUgbGVuZ3RoXG4gIHZhciBsZW5ndGhcbiAgaWYgKHR5cGUgPT09ICdudW1iZXInKVxuICAgIGxlbmd0aCA9IHN1YmplY3QgPiAwID8gc3ViamVjdCA+Pj4gMCA6IDBcbiAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICBsZW5ndGggPSBCdWZmZXIuYnl0ZUxlbmd0aChzdWJqZWN0LCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnb2JqZWN0JyAmJiBzdWJqZWN0ICE9PSBudWxsKSB7IC8vIGFzc3VtZSBvYmplY3QgaXMgYXJyYXktbGlrZVxuICAgIGlmIChzdWJqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkoc3ViamVjdC5kYXRhKSlcbiAgICAgIHN1YmplY3QgPSBzdWJqZWN0LmRhdGFcbiAgICBsZW5ndGggPSArc3ViamVjdC5sZW5ndGggPiAwID8gTWF0aC5mbG9vcigrc3ViamVjdC5sZW5ndGgpIDogMFxuICB9IGVsc2VcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtdXN0IHN0YXJ0IHdpdGggbnVtYmVyLCBidWZmZXIsIGFycmF5IG9yIHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IGtNYXhMZW5ndGgpXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gJyArXG4gICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aC50b1N0cmluZygxNikgKyAnIGJ5dGVzJylcblxuICB2YXIgYnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFByZWZlcnJlZDogUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICBidWYgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkobGVuZ3RoKSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIFRISVMgaW5zdGFuY2Ugb2YgQnVmZmVyIChjcmVhdGVkIGJ5IGBuZXdgKVxuICAgIGJ1ZiA9IHRoaXNcbiAgICBidWYubGVuZ3RoID0gbGVuZ3RoXG4gICAgYnVmLl9pc0J1ZmZlciA9IHRydWVcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiB0eXBlb2Ygc3ViamVjdC5ieXRlTGVuZ3RoID09PSAnbnVtYmVyJykge1xuICAgIC8vIFNwZWVkIG9wdGltaXphdGlvbiAtLSB1c2Ugc2V0IGlmIHdlJ3JlIGNvcHlpbmcgZnJvbSBhIHR5cGVkIGFycmF5XG4gICAgYnVmLl9zZXQoc3ViamVjdClcbiAgfSBlbHNlIGlmIChpc0FycmF5aXNoKHN1YmplY3QpKSB7XG4gICAgLy8gVHJlYXQgYXJyYXktaXNoIG9iamVjdHMgYXMgYSBieXRlIGFycmF5XG4gICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0LnJlYWRVSW50OChpKVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspXG4gICAgICAgIGJ1ZltpXSA9ICgoc3ViamVjdFtpXSAlIDI1NikgKyAyNTYpICUgMjU2XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgYnVmLndyaXRlKHN1YmplY3QsIDAsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiAhbm9aZXJvKSB7XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBidWZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgaWYgKGxlbmd0aCA+IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSlcbiAgICBidWYucGFyZW50ID0gcm9vdFBhcmVudFxuXG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBTbG93QnVmZmVyKSlcbiAgICByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybylcblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuICBkZWxldGUgYnVmLnBhcmVudFxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gKGEsIGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYSkgfHwgIUJ1ZmZlci5pc0J1ZmZlcihiKSlcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcbiAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IE1hdGgubWluKHgsIHkpOyBpIDwgbGVuICYmIGFbaV0gPT09IGJbaV07IGkrKykge31cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbkJ1ZmZlci5pc0VuY29kaW5nID0gZnVuY3Rpb24gKGVuY29kaW5nKSB7XG4gIHN3aXRjaCAoU3RyaW5nKGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICBjYXNlICdyYXcnOlxuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXR1cm4gdHJ1ZVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gZmFsc2VcbiAgfVxufVxuXG5CdWZmZXIuY29uY2F0ID0gZnVuY3Rpb24gKGxpc3QsIHRvdGFsTGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVXNhZ2U6IEJ1ZmZlci5jb25jYXQobGlzdFssIGxlbmd0aF0pJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF1cbiAgfVxuXG4gIHZhciBpXG4gIGlmICh0b3RhbExlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdG90YWxMZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIHRvdGFsTGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIodG90YWxMZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmJ5dGVMZW5ndGggPSBmdW5jdGlvbiAoc3RyLCBlbmNvZGluZykge1xuICB2YXIgcmV0XG4gIHN0ciA9IHN0ciArICcnXG4gIHN3aXRjaCAoZW5jb2RpbmcgfHwgJ3V0ZjgnKSB7XG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAncmF3JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggKiAyXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2hleCc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoID4+PiAxXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRUb0J5dGVzKHN0cikubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbi8vIHRvU3RyaW5nKGVuY29kaW5nLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0ID4+PiAwXG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkIHx8IGVuZCA9PT0gSW5maW5pdHkgPyB0aGlzLmxlbmd0aCA6IGVuZCA+Pj4gMFxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG4gIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmIChlbmQgPD0gc3RhcnQpIHJldHVybiAnJ1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSlcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KVxuICAgICAgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiAob2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuZ2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy5yZWFkVUludDgob2Zmc2V0KVxufVxuXG4vLyBgc2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAodiwgb2Zmc2V0KSB7XG4gIGNvbnNvbGUubG9nKCcuc2V0KCkgaXMgZGVwcmVjYXRlZC4gQWNjZXNzIHVzaW5nIGFycmF5IGluZGV4ZXMgaW5zdGVhZC4nKVxuICByZXR1cm4gdGhpcy53cml0ZVVJbnQ4KHYsIG9mZnNldClcbn1cblxuZnVuY3Rpb24gaGV4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG4gIHZhciByZW1haW5pbmcgPSBidWYubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cblxuICAvLyBtdXN0IGJlIGFuIGV2ZW4gbnVtYmVyIG9mIGRpZ2l0c1xuICB2YXIgc3RyTGVuID0gc3RyaW5nLmxlbmd0aFxuICBpZiAoc3RyTGVuICUgMiAhPT0gMCkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuXG4gIGlmIChsZW5ndGggPiBzdHJMZW4gLyAyKSB7XG4gICAgbGVuZ3RoID0gc3RyTGVuIC8gMlxuICB9XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgYnl0ZSA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4oYnl0ZSkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBieXRlXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gdXRmOFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIodXRmOFRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBhc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBibGl0QnVmZmVyKHV0ZjE2bGVUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgsIDIpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBTdXBwb3J0IGJvdGggKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKVxuICAvLyBhbmQgdGhlIGxlZ2FjeSAoc3RyaW5nLCBlbmNvZGluZywgb2Zmc2V0LCBsZW5ndGgpXG4gIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgaWYgKCFpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBlbmNvZGluZyA9IGxlbmd0aFxuICAgICAgbGVuZ3RoID0gdW5kZWZpbmVkXG4gICAgfVxuICB9IGVsc2UgeyAgLy8gbGVnYWN5XG4gICAgdmFyIHN3YXAgPSBlbmNvZGluZ1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgb2Zmc2V0ID0gbGVuZ3RoXG4gICAgbGVuZ3RoID0gc3dhcFxuICB9XG5cbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuXG4gIGlmIChsZW5ndGggPCAwIHx8IG9mZnNldCA8IDAgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2F0dGVtcHQgdG8gd3JpdGUgb3V0c2lkZSBidWZmZXIgYm91bmRzJyk7XG5cbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgIHJldCA9IHV0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgICByZXQgPSBhc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBiaW5hcnlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0ID0gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHV0ZjE2bGVXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW47XG4gICAgaWYgKHN0YXJ0IDwgMClcbiAgICAgIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKVxuICAgICAgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KVxuICAgIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZCwgdHJ1ZSlcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKVxuICAgIG5ld0J1Zi5wYXJlbnQgPSB0aGlzLnBhcmVudCB8fCB0aGlzXG5cbiAgcmV0dXJuIG5ld0J1ZlxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpXG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXVxuICB2YXIgbXVsID0gMVxuICB3aGlsZSAoYnl0ZUxlbmd0aCA+IDAgJiYgKG11bCAqPSAweDEwMCkpXG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXSAqIG11bDtcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKVxuICAgIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGhcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1pXVxuICB3aGlsZSAoaSA+IDAgJiYgKG11bCAqPSAweDEwMCkpXG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKVxuICAgIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKVxuICAgIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKVxuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpID4+PiAwICYgMHhGRlxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpXG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgPj4+IDAgJiAweEZGXG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0ludCh0aGlzLFxuICAgICAgICAgICAgIHZhbHVlLFxuICAgICAgICAgICAgIG9mZnNldCxcbiAgICAgICAgICAgICBieXRlTGVuZ3RoLFxuICAgICAgICAgICAgIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSkgLSAxLFxuICAgICAgICAgICAgIC1NYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpKVxuICB9XG5cbiAgdmFyIGkgPSAwXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpXG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSW50KHRoaXMsXG4gICAgICAgICAgICAgdmFsdWUsXG4gICAgICAgICAgICAgb2Zmc2V0LFxuICAgICAgICAgICAgIGJ5dGVMZW5ndGgsXG4gICAgICAgICAgICAgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKSAtIDEsXG4gICAgICAgICAgICAgLU1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSkpXG4gIH1cblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiAodGFyZ2V0LCB0YXJnZXRfc3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNvdXJjZSA9IHRoaXNcblxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0X3N0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldF9zdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRfc3RhcnQpIHRhcmdldF9zdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCBzb3VyY2UubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldF9zdGFydCA8IDApXG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHNvdXJjZS5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKVxuICAgIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0IDwgZW5kIC0gc3RhcnQpXG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG5cbiAgaWYgKGxlbiA8IDEwMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRfc3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0X3N0YXJ0KVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCA8IHN0YXJ0JylcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gdmFsdWVcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIGJ5dGVzID0gdXRmOFRvQnl0ZXModmFsdWUudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBnZXQvc2V0IG1ldGhvZHMgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fZ2V0ID0gYXJyLmdldFxuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnRMRSA9IEJQLnJlYWRVSW50TEVcbiAgYXJyLnJlYWRVSW50QkUgPSBCUC5yZWFkVUludEJFXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludExFID0gQlAucmVhZEludExFXG4gIGFyci5yZWFkSW50QkUgPSBCUC5yZWFkSW50QkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50TEUgPSBCUC53cml0ZVVJbnRMRVxuICBhcnIud3JpdGVVSW50QkUgPSBCUC53cml0ZVVJbnRCRVxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50TEUgPSBCUC53cml0ZUludExFXG4gIGFyci53cml0ZUludEJFID0gQlAud3JpdGVJbnRCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLXpcXC1dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlpc2ggKHN1YmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXkoc3ViamVjdCkgfHwgQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpIHx8XG4gICAgICBzdWJqZWN0ICYmIHR5cGVvZiBzdWJqZWN0ID09PSAnb2JqZWN0JyAmJlxuICAgICAgdHlwZW9mIHN1YmplY3QubGVuZ3RoID09PSAnbnVtYmVyJ1xufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzKHN0cmluZywgdW5pdHMpIHtcbiAgdmFyIGNvZGVQb2ludCwgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgYnl0ZXMgPSBbXVxuICB2YXIgaSA9IDBcblxuICBmb3IgKDsgaTxsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcblxuICAgICAgLy8gbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmIChsZWFkU3Vycm9nYXRlKSB7XG5cbiAgICAgICAgLy8gMiBsZWFkcyBpbiBhIHJvd1xuICAgICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gbm8gbGVhZCB5ZXRcbiAgICAgIGVsc2Uge1xuXG4gICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgIGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gdmFsaWQgbGVhZFxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgfVxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9XG4gICAgZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApO1xuICAgIH1cbiAgICBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApO1xuICAgIH1cbiAgICBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDIwMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG5cbiAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcblxuICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGhpID0gYyA+PiA4XG4gICAgbG8gPSBjICUgMjU2XG4gICAgYnl0ZUFycmF5LnB1c2gobG8pXG4gICAgYnl0ZUFycmF5LnB1c2goaGkpXG4gIH1cblxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMgKHN0cikge1xuICByZXR1cm4gYmFzZTY0LnRvQnl0ZUFycmF5KGJhc2U2NGNsZWFuKHN0cikpXG59XG5cbmZ1bmN0aW9uIGJsaXRCdWZmZXIgKHNyYywgZHN0LCBvZmZzZXQsIGxlbmd0aCwgdW5pdFNpemUpIHtcbiAgaWYgKHVuaXRTaXplKSBsZW5ndGggLT0gbGVuZ3RoICUgdW5pdFNpemU7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpXG4gICAgICBicmVha1xuICAgIGRzdFtpICsgb2Zmc2V0XSA9IHNyY1tpXVxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIGRlY29kZVV0ZjhDaGFyIChzdHIpIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHN0cilcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgcmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoMHhGRkZEKSAvLyBVVEYgOCBpbnZhbGlkIGNoYXJcbiAgfVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbihidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIG5CaXRzID0gLTcsXG4gICAgICBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDAsXG4gICAgICBkID0gaXNMRSA/IC0xIDogMSxcbiAgICAgIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV07XG5cbiAgaSArPSBkO1xuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBzID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gZUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIGUgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBtTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXM7XG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KTtcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pO1xuICAgIGUgPSBlIC0gZUJpYXM7XG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbik7XG59O1xuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24oYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGMsXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApLFxuICAgICAgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpLFxuICAgICAgZCA9IGlzTEUgPyAxIDogLTEsXG4gICAgICBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwO1xuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpO1xuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwO1xuICAgIGUgPSBlTWF4O1xuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKTtcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS07XG4gICAgICBjICo9IDI7XG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcyk7XG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrO1xuICAgICAgYyAvPSAyO1xuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDA7XG4gICAgICBlID0gZU1heDtcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gZSArIGVCaWFzO1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbik7XG4gICAgICBlID0gMDtcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KTtcblxuICBlID0gKGUgPDwgbUxlbikgfCBtO1xuICBlTGVuICs9IG1MZW47XG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCk7XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4O1xufTtcbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLyohXHJcbiAqIEBuYW1lIEphdmFTY3JpcHQvTm9kZUpTIE1lcmdlIHYxLjIuMFxyXG4gKiBAYXV0aG9yIHllaWtvc1xyXG4gKiBAcmVwb3NpdG9yeSBodHRwczovL2dpdGh1Yi5jb20veWVpa29zL2pzLm1lcmdlXHJcblxyXG4gKiBDb3B5cmlnaHQgMjAxNCB5ZWlrb3MgLSBNSVQgbGljZW5zZVxyXG4gKiBodHRwczovL3Jhdy5naXRodWIuY29tL3llaWtvcy9qcy5tZXJnZS9tYXN0ZXIvTElDRU5TRVxyXG4gKi9cclxuXHJcbjsoZnVuY3Rpb24oaXNOb2RlKSB7XHJcblxyXG5cdC8qKlxyXG5cdCAqIE1lcmdlIG9uZSBvciBtb3JlIG9iamVjdHMgXHJcblx0ICogQHBhcmFtIGJvb2w/IGNsb25lXHJcblx0ICogQHBhcmFtIG1peGVkLC4uLiBhcmd1bWVudHNcclxuXHQgKiBAcmV0dXJuIG9iamVjdFxyXG5cdCAqL1xyXG5cclxuXHR2YXIgUHVibGljID0gZnVuY3Rpb24oY2xvbmUpIHtcclxuXHJcblx0XHRyZXR1cm4gbWVyZ2UoY2xvbmUgPT09IHRydWUsIGZhbHNlLCBhcmd1bWVudHMpO1xyXG5cclxuXHR9LCBwdWJsaWNOYW1lID0gJ21lcmdlJztcclxuXHJcblx0LyoqXHJcblx0ICogTWVyZ2UgdHdvIG9yIG1vcmUgb2JqZWN0cyByZWN1cnNpdmVseSBcclxuXHQgKiBAcGFyYW0gYm9vbD8gY2xvbmVcclxuXHQgKiBAcGFyYW0gbWl4ZWQsLi4uIGFyZ3VtZW50c1xyXG5cdCAqIEByZXR1cm4gb2JqZWN0XHJcblx0ICovXHJcblxyXG5cdFB1YmxpYy5yZWN1cnNpdmUgPSBmdW5jdGlvbihjbG9uZSkge1xyXG5cclxuXHRcdHJldHVybiBtZXJnZShjbG9uZSA9PT0gdHJ1ZSwgdHJ1ZSwgYXJndW1lbnRzKTtcclxuXHJcblx0fTtcclxuXHJcblx0LyoqXHJcblx0ICogQ2xvbmUgdGhlIGlucHV0IHJlbW92aW5nIGFueSByZWZlcmVuY2VcclxuXHQgKiBAcGFyYW0gbWl4ZWQgaW5wdXRcclxuXHQgKiBAcmV0dXJuIG1peGVkXHJcblx0ICovXHJcblxyXG5cdFB1YmxpYy5jbG9uZSA9IGZ1bmN0aW9uKGlucHV0KSB7XHJcblxyXG5cdFx0dmFyIG91dHB1dCA9IGlucHV0LFxyXG5cdFx0XHR0eXBlID0gdHlwZU9mKGlucHV0KSxcclxuXHRcdFx0aW5kZXgsIHNpemU7XHJcblxyXG5cdFx0aWYgKHR5cGUgPT09ICdhcnJheScpIHtcclxuXHJcblx0XHRcdG91dHB1dCA9IFtdO1xyXG5cdFx0XHRzaXplID0gaW5wdXQubGVuZ3RoO1xyXG5cclxuXHRcdFx0Zm9yIChpbmRleD0wO2luZGV4PHNpemU7KytpbmRleClcclxuXHJcblx0XHRcdFx0b3V0cHV0W2luZGV4XSA9IFB1YmxpYy5jbG9uZShpbnB1dFtpbmRleF0pO1xyXG5cclxuXHRcdH0gZWxzZSBpZiAodHlwZSA9PT0gJ29iamVjdCcpIHtcclxuXHJcblx0XHRcdG91dHB1dCA9IHt9O1xyXG5cclxuXHRcdFx0Zm9yIChpbmRleCBpbiBpbnB1dClcclxuXHJcblx0XHRcdFx0b3V0cHV0W2luZGV4XSA9IFB1YmxpYy5jbG9uZShpbnB1dFtpbmRleF0pO1xyXG5cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gb3V0cHV0O1xyXG5cclxuXHR9O1xyXG5cclxuXHQvKipcclxuXHQgKiBNZXJnZSB0d28gb2JqZWN0cyByZWN1cnNpdmVseVxyXG5cdCAqIEBwYXJhbSBtaXhlZCBpbnB1dFxyXG5cdCAqIEBwYXJhbSBtaXhlZCBleHRlbmRcclxuXHQgKiBAcmV0dXJuIG1peGVkXHJcblx0ICovXHJcblxyXG5cdGZ1bmN0aW9uIG1lcmdlX3JlY3Vyc2l2ZShiYXNlLCBleHRlbmQpIHtcclxuXHJcblx0XHRpZiAodHlwZU9mKGJhc2UpICE9PSAnb2JqZWN0JylcclxuXHJcblx0XHRcdHJldHVybiBleHRlbmQ7XHJcblxyXG5cdFx0Zm9yICh2YXIga2V5IGluIGV4dGVuZCkge1xyXG5cclxuXHRcdFx0aWYgKHR5cGVPZihiYXNlW2tleV0pID09PSAnb2JqZWN0JyAmJiB0eXBlT2YoZXh0ZW5kW2tleV0pID09PSAnb2JqZWN0Jykge1xyXG5cclxuXHRcdFx0XHRiYXNlW2tleV0gPSBtZXJnZV9yZWN1cnNpdmUoYmFzZVtrZXldLCBleHRlbmRba2V5XSk7XHJcblxyXG5cdFx0XHR9IGVsc2Uge1xyXG5cclxuXHRcdFx0XHRiYXNlW2tleV0gPSBleHRlbmRba2V5XTtcclxuXHJcblx0XHRcdH1cclxuXHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIGJhc2U7XHJcblxyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogTWVyZ2UgdHdvIG9yIG1vcmUgb2JqZWN0c1xyXG5cdCAqIEBwYXJhbSBib29sIGNsb25lXHJcblx0ICogQHBhcmFtIGJvb2wgcmVjdXJzaXZlXHJcblx0ICogQHBhcmFtIGFycmF5IGFyZ3ZcclxuXHQgKiBAcmV0dXJuIG9iamVjdFxyXG5cdCAqL1xyXG5cclxuXHRmdW5jdGlvbiBtZXJnZShjbG9uZSwgcmVjdXJzaXZlLCBhcmd2KSB7XHJcblxyXG5cdFx0dmFyIHJlc3VsdCA9IGFyZ3ZbMF0sXHJcblx0XHRcdHNpemUgPSBhcmd2Lmxlbmd0aDtcclxuXHJcblx0XHRpZiAoY2xvbmUgfHwgdHlwZU9mKHJlc3VsdCkgIT09ICdvYmplY3QnKVxyXG5cclxuXHRcdFx0cmVzdWx0ID0ge307XHJcblxyXG5cdFx0Zm9yICh2YXIgaW5kZXg9MDtpbmRleDxzaXplOysraW5kZXgpIHtcclxuXHJcblx0XHRcdHZhciBpdGVtID0gYXJndltpbmRleF0sXHJcblxyXG5cdFx0XHRcdHR5cGUgPSB0eXBlT2YoaXRlbSk7XHJcblxyXG5cdFx0XHRpZiAodHlwZSAhPT0gJ29iamVjdCcpIGNvbnRpbnVlO1xyXG5cclxuXHRcdFx0Zm9yICh2YXIga2V5IGluIGl0ZW0pIHtcclxuXHJcblx0XHRcdFx0dmFyIHNpdGVtID0gY2xvbmUgPyBQdWJsaWMuY2xvbmUoaXRlbVtrZXldKSA6IGl0ZW1ba2V5XTtcclxuXHJcblx0XHRcdFx0aWYgKHJlY3Vyc2l2ZSkge1xyXG5cclxuXHRcdFx0XHRcdHJlc3VsdFtrZXldID0gbWVyZ2VfcmVjdXJzaXZlKHJlc3VsdFtrZXldLCBzaXRlbSk7XHJcblxyXG5cdFx0XHRcdH0gZWxzZSB7XHJcblxyXG5cdFx0XHRcdFx0cmVzdWx0W2tleV0gPSBzaXRlbTtcclxuXHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0fVxyXG5cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gcmVzdWx0O1xyXG5cclxuXHR9XHJcblxyXG5cdC8qKlxyXG5cdCAqIEdldCB0eXBlIG9mIHZhcmlhYmxlXHJcblx0ICogQHBhcmFtIG1peGVkIGlucHV0XHJcblx0ICogQHJldHVybiBzdHJpbmdcclxuXHQgKlxyXG5cdCAqIEBzZWUgaHR0cDovL2pzcGVyZi5jb20vdHlwZW9mdmFyXHJcblx0ICovXHJcblxyXG5cdGZ1bmN0aW9uIHR5cGVPZihpbnB1dCkge1xyXG5cclxuXHRcdHJldHVybiAoe30pLnRvU3RyaW5nLmNhbGwoaW5wdXQpLnNsaWNlKDgsIC0xKS50b0xvd2VyQ2FzZSgpO1xyXG5cclxuXHR9XHJcblxyXG5cdGlmIChpc05vZGUpIHtcclxuXHJcblx0XHRtb2R1bGUuZXhwb3J0cyA9IFB1YmxpYztcclxuXHJcblx0fSBlbHNlIHtcclxuXHJcblx0XHR3aW5kb3dbcHVibGljTmFtZV0gPSBQdWJsaWM7XHJcblxyXG5cdH1cclxuXHJcbn0pKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnICYmIG1vZHVsZSAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnICYmIG1vZHVsZS5leHBvcnRzKTsiLCIvKipcbiAqIE5pbWJsZVxuICogQ29weXJpZ2h0IChjKSAyMDExIENhb2xhbiBNY01haG9uXG4gKlxuICogTmltYmxlIGlzIGZyZWVseSBkaXN0cmlidXRhYmxlIHVuZGVyIHRoZSBNSVQgbGljZW5zZS5cbiAqXG4gKiBUaGlzIHNvdXJjZSBjb2RlIGlzIG9wdGltaXplZCBmb3IgbWluaWZpY2F0aW9uIGFuZCBnemlwIGNvbXByZXNzaW9uLCBub3RcbiAqIHJlYWRhYmlsaXR5LiBJZiB5b3Ugd2FudCByZWFzc3VyYW5jZSwgc2VlIHRoZSB0ZXN0IHN1aXRlLlxuICovXG5cbihmdW5jdGlvbiAoZXhwb3J0cykge1xuXG4gICAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyB8fCBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gW107XG4gICAgICAgIGZvciAodmFyIGsgaW4gb2JqKSB7XG4gICAgICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGspKSB7XG4gICAgICAgICAgICAgICAgcmVzdWx0cy5wdXNoKGspO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH07XG5cbiAgICB2YXIgZmFsbGJhY2sgPSBmdW5jdGlvbiAobmFtZSwgZmFsbGJhY2spIHtcbiAgICAgICAgdmFyIG5hdGl2ZUZuID0gQXJyYXkucHJvdG90eXBlW25hbWVdO1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIG1lbW8pIHtcbiAgICAgICAgICAgIHZhciBmbiA9IG9iaiA/IG9ialtuYW1lXTogMDtcbiAgICAgICAgICAgIHJldHVybiBmbiAmJiBmbiA9PT0gbmF0aXZlRm4gP1xuICAgICAgICAgICAgICAgIGZuLmNhbGwob2JqLCBpdGVyYXRvciwgbWVtbyk6XG4gICAgICAgICAgICAgICAgZmFsbGJhY2sob2JqLCBpdGVyYXRvciwgbWVtbyk7XG4gICAgICAgIH07XG4gICAgfTtcblxuICAgIHZhciBlYWNoU3luYyA9IGZhbGxiYWNrKCdmb3JFYWNoJywgZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IpIHtcbiAgICAgICAgdmFyIGlzT2JqID0gb2JqIGluc3RhbmNlb2YgT2JqZWN0O1xuICAgICAgICB2YXIgYXJyID0gaXNPYmogPyBrZXlzKG9iaik6IChvYmogfHwgW10pO1xuICAgICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYXJyLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgayA9IGlzT2JqID8gYXJyW2ldOiBpO1xuICAgICAgICAgICAgaXRlcmF0b3Iob2JqW2tdLCBrLCBvYmopO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICB2YXIgZWFjaFBhcmFsbGVsID0gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBsZW4gPSBvYmoubGVuZ3RoIHx8IGtleXMob2JqKS5sZW5ndGg7XG4gICAgICAgIGlmICghbGVuKSB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgY29tcGxldGVkID0gMDtcbiAgICAgICAgZWFjaFN5bmMob2JqLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgY2IgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uICgpIHt9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCsrY29tcGxldGVkID09PSBsZW4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICAgICAgICAgICAgaWYgKGl0ZXJhdG9yLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGFyZ3MgPSBhcmdzLnNsaWNlKDAsIGl0ZXJhdG9yLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgICAgIGFyZ3NbaXRlcmF0b3IubGVuZ3RoIC0gMV0gPSBjYjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGFyZ3MucHVzaChjYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVyYXRvci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIHZhciBlYWNoU2VyaWVzID0gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciBrZXlzX2xpc3QgPSBrZXlzKG9iaik7XG4gICAgICAgIGlmICgha2V5c19saXN0Lmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKCk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGNvbXBsZXRlZCA9IDA7XG4gICAgICAgIHZhciBpdGVyYXRlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGsgPSBrZXlzX2xpc3RbY29tcGxldGVkXTtcbiAgICAgICAgICAgIHZhciBhcmdzID0gW29ialtrXSwgaywgb2JqXS5zbGljZSgwLCBpdGVyYXRvci5sZW5ndGggLSAxKTtcbiAgICAgICAgICAgIGFyZ3NbaXRlcmF0b3IubGVuZ3RoIC0gMV0gPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgaWYgKGVycikge1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayA9IGZ1bmN0aW9uICgpIHt9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCsrY29tcGxldGVkID09PSBrZXlzX2xpc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgaXRlcmF0ZSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGl0ZXJhdG9yLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9O1xuICAgICAgICBpdGVyYXRlKCk7XG4gICAgfTtcblxuICAgIHZhciBtYXBTeW5jID0gZmFsbGJhY2soJ21hcCcsIGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gW107XG4gICAgICAgIGVhY2hTeW5jKG9iaiwgZnVuY3Rpb24gKHYsIGssIG9iaikge1xuICAgICAgICAgICAgcmVzdWx0c1tyZXN1bHRzLmxlbmd0aF0gPSBpdGVyYXRvcih2LCBrLCBvYmopO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgfSk7XG5cbiAgICB2YXIgbWFwQXN5bmMgPSBmdW5jdGlvbiAoZWFjaGZuKSB7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHZhciByZXN1bHRzID0gW107XG4gICAgICAgICAgICBlYWNoZm4ob2JqLCBmdW5jdGlvbiAodmFsdWUsIGksIG9iaiwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgICAgICB2YXIgY2IgPSBmdW5jdGlvbiAoZXJyLCB2KSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHNbcmVzdWx0cy5sZW5ndGhdID0gdjtcbiAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHZhciBhcmdzID0gW3ZhbHVlLCBpLCBvYmpdO1xuICAgICAgICAgICAgICAgIGlmIChpdGVyYXRvci5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgYXJncyA9IGFyZ3Muc2xpY2UoMCwgaXRlcmF0b3IubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICAgICAgICAgIGFyZ3NbaXRlcmF0b3IubGVuZ3RoIC0gMV0gPSBjYjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGFyZ3MucHVzaChjYik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGl0ZXJhdG9yLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVyciwgcmVzdWx0cyk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcbiAgICB9O1xuXG4gICAgdmFyIGZpbHRlclN5bmMgPSBmYWxsYmFjaygnZmlsdGVyJywgZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gW107XG4gICAgICAgIGVhY2hTeW5jKG9iaiwgZnVuY3Rpb24gKHYsIGssIG9iaikge1xuICAgICAgICAgICAgaWYgKGl0ZXJhdG9yKHYsIGssIG9iaikpIHtcbiAgICAgICAgICAgICAgICByZXN1bHRzW3Jlc3VsdHMubGVuZ3RoXSA9IHY7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9KTtcblxuICAgIHZhciBmaWx0ZXJQYXJhbGxlbCA9IGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcmVzdWx0cyA9IFtdO1xuICAgICAgICBlYWNoUGFyYWxsZWwob2JqLCBmdW5jdGlvbiAodmFsdWUsIGssIG9iaiwgY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHZhciBjYiA9IGZ1bmN0aW9uIChlcnIsIGEpIHtcbiAgICAgICAgICAgICAgICBpZiAoYSkge1xuICAgICAgICAgICAgICAgICAgICByZXN1bHRzW3Jlc3VsdHMubGVuZ3RoXSA9IHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIHZhciBhcmdzID0gW3ZhbHVlLCBrLCBvYmpdO1xuICAgICAgICAgICAgaWYgKGl0ZXJhdG9yLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGFyZ3MgPSBhcmdzLnNsaWNlKDAsIGl0ZXJhdG9yLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgICAgIGFyZ3NbaXRlcmF0b3IubGVuZ3RoIC0gMV0gPSBjYjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIGFyZ3MucHVzaChjYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpdGVyYXRvci5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgY2FsbGJhY2soZXJyLCByZXN1bHRzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIHZhciByZWR1Y2VTeW5jID0gZmFsbGJhY2soJ3JlZHVjZScsIGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBtZW1vKSB7XG4gICAgICAgIGVhY2hTeW5jKG9iaiwgZnVuY3Rpb24gKHYsIGksIG9iaikge1xuICAgICAgICAgICAgbWVtbyA9IGl0ZXJhdG9yKG1lbW8sIHYsIGksIG9iaik7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbWVtbztcbiAgICB9KTtcblxuICAgIHZhciByZWR1Y2VTZXJpZXMgPSBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgbWVtbywgY2FsbGJhY2spIHtcbiAgICAgICAgZWFjaFNlcmllcyhvYmosIGZ1bmN0aW9uICh2YWx1ZSwgaSwgb2JqLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgdmFyIGNiID0gZnVuY3Rpb24gKGVyciwgdikge1xuICAgICAgICAgICAgICAgIG1lbW8gPSB2O1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBbbWVtbywgdmFsdWUsIGksIG9ial07XG4gICAgICAgICAgICBpZiAoaXRlcmF0b3IubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXJncyA9IGFyZ3Muc2xpY2UoMCwgaXRlcmF0b3IubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICAgICAgYXJnc1tpdGVyYXRvci5sZW5ndGggLSAxXSA9IGNiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgYXJncy5wdXNoKGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGl0ZXJhdG9yLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnIsIG1lbW8pO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgZXhwb3J0cy5lYWNoID0gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiAoY2FsbGJhY2sgPyBlYWNoUGFyYWxsZWw6IGVhY2hTeW5jKShvYmosIGl0ZXJhdG9yLCBjYWxsYmFjayk7XG4gICAgfTtcbiAgICBleHBvcnRzLm1hcCA9IGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBjYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gKGNhbGxiYWNrID8gbWFwQXN5bmMoZWFjaFBhcmFsbGVsKTogbWFwU3luYykob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spO1xuICAgIH07XG4gICAgZXhwb3J0cy5maWx0ZXIgPSBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIChjYWxsYmFjayA/IGZpbHRlclBhcmFsbGVsOiBmaWx0ZXJTeW5jKShvYmosIGl0ZXJhdG9yLCBjYWxsYmFjayk7XG4gICAgfTtcbiAgICBleHBvcnRzLnJlZHVjZSA9IGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBtZW1vLCBjYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gKGNhbGxiYWNrID8gcmVkdWNlU2VyaWVzOiByZWR1Y2VTeW5jKShvYmosIGl0ZXJhdG9yLCBtZW1vLCBjYWxsYmFjayk7XG4gICAgfTtcblxuICAgIGV4cG9ydHMucGFyYWxsZWwgPSBmdW5jdGlvbiAoZm5zLCBjYWxsYmFjaykge1xuICAgICAgICB2YXIgcmVzdWx0cyA9IG5ldyBmbnMuY29uc3RydWN0b3IoKTtcbiAgICAgICAgZWFjaFBhcmFsbGVsKGZucywgZnVuY3Rpb24gKGZuLCBrLCBjYikge1xuICAgICAgICAgICAgZm4oZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgIHZhciB2ID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAgICAgICAgICAgICByZXN1bHRzW2tdID0gdi5sZW5ndGggPD0gMSA/IHZbMF06IHY7XG4gICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAoY2FsbGJhY2sgfHwgZnVuY3Rpb24gKCkge30pKGVyciwgcmVzdWx0cyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBleHBvcnRzLnNlcmllcyA9IGZ1bmN0aW9uIChmbnMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gbmV3IGZucy5jb25zdHJ1Y3RvcigpO1xuICAgICAgICBlYWNoU2VyaWVzKGZucywgZnVuY3Rpb24gKGZuLCBrLCBjYikge1xuICAgICAgICAgICAgZm4oZnVuY3Rpb24gKGVyciwgcmVzdWx0KSB7XG4gICAgICAgICAgICAgICAgdmFyIHYgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgICAgICAgICAgIHJlc3VsdHNba10gPSB2Lmxlbmd0aCA8PSAxID8gdlswXTogdjtcbiAgICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIChjYWxsYmFjayB8fCBmdW5jdGlvbiAoKSB7fSkoZXJyLCByZXN1bHRzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyB0aGlzLl8gPSB0aGlzLl8gfHwge306IGV4cG9ydHMpKTtcbiJdfQ==

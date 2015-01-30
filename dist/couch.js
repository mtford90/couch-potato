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
        var auth = opts.auth,
            adminAuth = {
                method: AUTH_METHOD.BASIC,
                username: DEFAULT_ADMIN,
                password: DEFAULT_ADMIN
            };

        if (auth) {
            if (auth.method) {
                if (auth.method == AUTH_METHOD.BASIC) {
                    if (!auth.username) {
                        throw new CouchError({message: 'Must specify username if using basic auth'});
                    }
                    if (!auth.password) {
                        throw new CouchError({message: 'Must specify password if using basic auth'});
                    }
                }
                else {
                    throw new CouchError({message: 'Unknown auth methid "' + auth.method + '"'});
                }
            }
            else {
                throw new CouchError({message: 'Must specify method in auth'});
            }
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
            var inNodeEnvironment = !global['XMLHttpRequest'];
            if (inNodeEnvironment) {
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

    couchdb.AUTH_METHOD = AUTH_METHOD;
    couchdb.CouchError = CouchError;

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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJmcm9udC9zcmMvY291Y2hkYi5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9tZXJnZS9tZXJnZS5qcyIsIm5vZGVfbW9kdWxlcy9uaW1ibGUvbmltYmxlLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNqb0NBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNweUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIoZnVuY3Rpb24gKHJvb3QpIHtcblxuICAgIHZhciBfID0gcmVxdWlyZSgnbmltYmxlJyksXG4gICAgICAgIG1lcmdlID0gcmVxdWlyZSgnbWVyZ2UnKSxcbiAgICAgICAgbm9kZUh0dHAgPSBudWxsLFxuICAgICAgICB1cmwgPSBudWxsO1xuXG4gICAgdmFyIGJ0b2EgPSByb290LmJ0b2E7XG4gICAgaWYgKCFidG9hKSBidG9hID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdHIpLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9O1xuXG4gICAgLyoqXG4gICAgICogTm9ybWFsaXNlIHRoZSBob3N0IHBhcmFtZXRlciBlLmcuIHN0YW5kYXJkaXNlIGZvcndhcmQgc2xhc2gsIHByb3RvY29sIGV0Yy5cbiAgICAgKiBAcGFyYW0gaG9zdFxuICAgICAqIEByZXR1cm5zIHsqfVxuICAgICAqL1xuICAgIGZ1bmN0aW9uIG5vcm1hbGlzZUhvc3QoaG9zdCkge1xuICAgICAgICBob3N0ID0gaG9zdCB8fCAnaHR0cDovL2xvY2FsaG9zdDo1OTg0JztcbiAgICAgICAgaWYgKGhvc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICBpZiAoaG9zdFtob3N0Lmxlbmd0aCAtIDFdID09ICcvJykge1xuICAgICAgICAgICAgICAgIGhvc3QgPSBob3N0LnN1YnN0cmluZygwLCBob3N0Lmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBob3N0LnJlcGxhY2UoJ2h0dHA6Ly8nLCAnJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm9ybWFsaXNlRGIoZGIpIHtcbiAgICAgICAgcmV0dXJuIGRiIHx8ICdkYic7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gaXNTdHJpbmcoc3RyKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2Ygc3RyID09ICdzdHJpbmcnIHx8IHN0ciBpbnN0YW5jZW9mIFN0cmluZztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBpc09iamVjdChvKSB7XG4gICAgICAgIHJldHVybiB0eXBlb2YgbyA9PSAnb2JqZWN0JztcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFbmNhcHN1bGF0ZXMgZXJyb3JzIHByb2R1Y2VkIHdoaWxzdCBpbnRlcmFjdGluZyB3aXRoIENvdWNoREIgb3ZlciBIVFRQLlxuICAgICAqXG4gICAgICogQHBhcmFtIG9wdHNcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gW29wdHMubWVzc2FnZV0gLSBFcnJvciBtZXNzYWdlXG4gICAgICogQHBhcmFtIHtqcVhIUnxYTUxIdHRwUmVxdWVzdH0gW29wdHMueGhyXSAtIGEganFYSFIgb3IgWE1MSHR0cHJlcXVlc3Qgb2JqZWN0XG4gICAgICogQHBhcmFtIHtFcnJvcn0gW29wdHMudGhyb3duXSAtIEFuIEVycm9yIG9iamVjdFxuICAgICAqIEBjb25zdHJ1Y3RvclxuICAgICAqL1xuICAgIGZ1bmN0aW9uIENvdWNoRXJyb3Iob3B0cykge1xuICAgICAgICBtZXJnZSh0aGlzLCBvcHRzKTtcbiAgICAgICAgdGhpcy5pc0Vycm9yID0gdHJ1ZTtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnRpZXModGhpcywge1xuICAgICAgICAgICAgaXNIdHRwRXJyb3I6IHtcbiAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICEhKHRoaXMuaXNOb2RlSHR0cEVycm9yIHx8IHRoaXMuaXNCcm93c2VySHR0cEVycm9yKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNOb2RlSHR0cEVycm9yOiB7XG4gICAgICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAhIXRoaXMucmVzcG9uc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGlzQnJvd3Nlckh0dHBFcnJvcjoge1xuICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gISF0aGlzLnhocjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNUaHJvd25FcnJvcjoge1xuICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gISF0aGlzLnRocm93bjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgaXNVc2VyRXJyb3I6IHtcbiAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuICF0aGlzLmlzVGhyb3duRXJyb3IgJiYgIXRoaXMuaXNIdHRwRXJyb3JcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtBcnJheX0gcmVxdWlyZWQgLSBMaXN0IG9mIG9wdGlvbnMgdGhhdCBjYW5ub3QgYmUgbnVsbC91bmRlZmluZWRcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0cyAtIFRoZSBvcHRpb25zIHRvIGJlIHZlcmlmaWVkXG4gICAgICogQHBhcmFtIHtGdW5jdGlvbn0gW2NiXSAtIENhbGxiYWNrIHRvIGNhbGxiYWNrIHdpdGggYW4gZXJyb3IuXG4gICAgICogQHJldHVybnMge0FycmF5fSBtaXNzaW5nT3B0aW9uc1xuICAgICAqL1xuICAgIGZ1bmN0aW9uIGFzc2VydE9wdGlvbnMocmVxdWlyZWQsIG9wdHMsIGNiKSB7XG4gICAgICAgIHZhciBtaXNzaW5nID0gW107XG4gICAgICAgIHJlcXVpcmVkLmZvckVhY2goZnVuY3Rpb24gKG9wdCkge1xuICAgICAgICAgICAgaWYgKG9wdHNbb3B0XSA9PSB1bmRlZmluZWQpIG1pc3NpbmcucHVzaChvcHQpO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG1pc3NpbmcubGVuZ3RoICYmIGNiKSBjYihuZXcgQ291Y2hFcnJvcih7bWVzc2FnZTogJ01pc3Npbmcgb3B0aW9uczogJyArIG1pc3Npbmcuam9pbignLCAnKX0pKTtcbiAgICAgICAgcmV0dXJuIG1pc3Npbmc7XG4gICAgfVxuXG4gICAgdmFyIEFVVEhfTUVUSE9EID0ge1xuICAgICAgICBCQVNJQzogJ2Jhc2ljJ1xuICAgIH07XG5cbiAgICB2YXIgTUlNRSA9IHtcbiAgICAgICAgSlNPTjogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICBQTEFJTl9URVhUOiAndGV4dC9wbGFpbidcbiAgICB9O1xuXG4gICAgdmFyIERFRkFVTFRfQURNSU4gPSAnYWRtaW4nO1xuXG4gICAgLyoqXG4gICAgICogQHBhcmFtIGFyclxuICAgICAqIEBjb25zdHJ1Y3RvclxuICAgICAqL1xuICAgIGZ1bmN0aW9uIFNldChhcnIpIHtcbiAgICAgICAgYXJyLmZvckVhY2goZnVuY3Rpb24gKGVsKSB7XG4gICAgICAgICAgICB0aGlzW2VsXSA9IGVsO1xuICAgICAgICB9LmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIFNldC5wcm90b3R5cGUubWVtYmVyT2YgPSBmdW5jdGlvbiAob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmogaW4gdGhpcztcbiAgICB9O1xuXG4gICAgdmFyIElHTk9SRV9EQVRBQkFTRVMgPSBuZXcgU2V0KFsnX3JlcGxpY2F0b3InXSk7XG5cbiAgICB2YXIgY291Y2hkYiA9IGZ1bmN0aW9uIChvcHRzKSB7XG4gICAgICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuXG4gICAgICAgIHZhciBob3N0ID0gbm9ybWFsaXNlSG9zdChvcHRzLmhvc3QpLFxuICAgICAgICAgICAgZGVmYXVsdERCID0gbm9ybWFsaXNlRGIob3B0cy5kYik7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEVuY2Fwc3VsYXRlcyBhdXRoIHN0cmF0ZWd5IGUuZy4gc2Vzc2lvbiwgdG9rZW4uIFVzZWQgaW4gZXZlcnkgSFRUUCByZXF1ZXN0IHRvIGNvdWNoLlxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIGF1dGggPSBvcHRzLmF1dGgsXG4gICAgICAgICAgICBhZG1pbkF1dGggPSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiBBVVRIX01FVEhPRC5CQVNJQyxcbiAgICAgICAgICAgICAgICB1c2VybmFtZTogREVGQVVMVF9BRE1JTixcbiAgICAgICAgICAgICAgICBwYXNzd29yZDogREVGQVVMVF9BRE1JTlxuICAgICAgICAgICAgfTtcblxuICAgICAgICBpZiAoYXV0aCkge1xuICAgICAgICAgICAgaWYgKGF1dGgubWV0aG9kKSB7XG4gICAgICAgICAgICAgICAgaWYgKGF1dGgubWV0aG9kID09IEFVVEhfTUVUSE9ELkJBU0lDKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghYXV0aC51c2VybmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IENvdWNoRXJyb3Ioe21lc3NhZ2U6ICdNdXN0IHNwZWNpZnkgdXNlcm5hbWUgaWYgdXNpbmcgYmFzaWMgYXV0aCd9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAoIWF1dGgucGFzc3dvcmQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiAnTXVzdCBzcGVjaWZ5IHBhc3N3b3JkIGlmIHVzaW5nIGJhc2ljIGF1dGgnfSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiAnVW5rbm93biBhdXRoIG1ldGhpZCBcIicgKyBhdXRoLm1ldGhvZCArICdcIid9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgQ291Y2hFcnJvcih7bWVzc2FnZTogJ011c3Qgc3BlY2lmeSBtZXRob2QgaW4gYXV0aCd9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENvbmZpZ3VyZSB0aGUgYWpheC9ub2RlSHR0cCBvcHRpb25zIHRvIG1hdGNoIHRoZSBjb25maWd1cmVkIGF1dGhvcmlzYXRpb24gbWV0aG9kLlxuICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgKiBAcGFyYW0gYXV0aFxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgZnVuY3Rpb24gX2NvbmZpZ3VyZUF1dGgob3B0cywgYXV0aCkge1xuICAgICAgICAgICAgaWYgKGF1dGgpIHtcbiAgICAgICAgICAgICAgICB2YXIgaGVhZGVycyA9IG9wdHMuaGVhZGVycyB8fCB7fTtcbiAgICAgICAgICAgICAgICBvcHRzLmhlYWRlcnMgPSBoZWFkZXJzO1xuICAgICAgICAgICAgICAgIC8vIEFsbG93IGZvciBhdXRob3JpemF0aW9uIG92ZXJyaWRlcy5cbiAgICAgICAgICAgICAgICBpZiAoIWhlYWRlcnMuQXV0aG9yaXphdGlvbikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXV0aC5tZXRob2QgPT0gQVVUSF9NRVRIT0QuQkFTSUMpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE5vdGU6IGpRdWVyeSA+PTEuNyBoYXMgdXNlcm5hbWUvcGFzc3dvcmQgb3B0aW9ucy4gSSBkbyB0aGlzIHNpbXBseSBmb3IgYmFja3dhcmRzXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBjb21wYXRpYmlsaXR5LlxuICAgICAgICAgICAgICAgICAgICAgICAgaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0Jhc2ljICcgKyBidG9hKGF1dGgudXNlcm5hbWUgKyAnOicgKyBhdXRoLnBhc3N3b3JkKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgKiBAcGFyYW0gb3B0cy5wYXRoXG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5wcm90b2NvbF1cbiAgICAgICAgICogQHJldHVybnMge3N0cmluZ31cbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIF9jb25zdHJ1Y3RVUkwob3B0cykge1xuICAgICAgICAgICAgdmFyIHByb3RvY29sID0gb3B0cy5wcm90b2NvbCB8fCAnaHR0cDovLycsXG4gICAgICAgICAgICAgICAgcGF0aCA9IG9wdHMucGF0aDtcbiAgICAgICAgICAgIHJldHVybiBwcm90b2NvbCArIGhvc3QgKyAocGF0aC5sZW5ndGggPyAocGF0aFswXSA9PSAnLycgPyAnJyA6ICcvJykgOiAnJykgKyBwYXRoO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIHRyYW5zZm9ybSBkYXRhIGludG8gYSBzdHJpbmcgZGVwZW5kaW5nIG9uIHRoZSBtaW1ldHlwZVxuICAgICAgICAgKiBAcGFyYW0gbWltZVR5cGVcbiAgICAgICAgICogQHBhcmFtIGRhdGFcbiAgICAgICAgICogQHJldHVybnMgeyp9XG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBjb2VyY2VEYXRhKG1pbWVUeXBlLCBkYXRhKSB7XG4gICAgICAgICAgICB2YXIgY29lcmNlZERhdGE7XG4gICAgICAgICAgICBpZiAobWltZVR5cGUgPT0gTUlNRS5KU09OKSB7XG4gICAgICAgICAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFpc1N0cmluZyhkYXRhKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb2VyY2VkRGF0YSA9IEpTT04uc3RyaW5naWZ5KGRhdGEpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gbmV3IENvdWNoRXJyb3Ioe3Rocm93bjogZX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgY29lcmNlZERhdGEgPSBkYXRhO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvZXJjZWREYXRhO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNlbmQgYSBIVFRQIHJlcXVlc3QgdXNpbmcganF1ZXJ5XG4gICAgICAgICAqIEBwYXJhbSBvcHRzIC0gVGhlIHVzdWFsIGpxdWVyeSBvcHRzICtcbiAgICAgICAgICogQHBhcmFtIG9wdHMucGF0aCAtIFBhdGggdG8gYXBwZW5kIHRvIGhvc3RcbiAgICAgICAgICogQHBhcmFtIG9wdHMuYWRtaW4gLSBUcnVlIGlmIGVuZHBvaW50IHJlcXVpcmVzIGFkbWluIGFjY2Vzc1xuICAgICAgICAgKiBAcGFyYW0gb3B0cy5pZ25vcmVBdXRoXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLmNvbnRlbnRUeXBlXG4gICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBfJGh0dHAob3B0cywgY2IpIHtcbiAgICAgICAgICAgIGNiID0gY2IgfHwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIC8vIERvIG5vdGhpbmcuXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgb3B0cyA9IG1lcmdlKHtcbiAgICAgICAgICAgICAgICB0eXBlOiAnR0VUJyxcbiAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogTUlNRS5KU09OXG4gICAgICAgICAgICB9LCBvcHRzIHx8IHt9KTtcbiAgICAgICAgICAgIHZhciBjb2VyY2VkRGF0YSA9IGNvZXJjZURhdGEob3B0cy5jb250ZW50VHlwZSwgb3B0cy5kYXRhKTtcbiAgICAgICAgICAgIGlmIChjb2VyY2VkRGF0YSAmJiBjb2VyY2VkRGF0YS5pc0Vycm9yKSB7XG4gICAgICAgICAgICAgICAgY2IoY29lcmNlZERhdGEpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChjb2VyY2VkRGF0YSAhPSB1bmRlZmluZWQpIG9wdHMuZGF0YSA9IGNvZXJjZWREYXRhO1xuICAgICAgICAgICAgaWYgKCFvcHRzLmlnbm9yZUF1dGgpIF9jb25maWd1cmVBdXRoKG9wdHMsIG9wdHMuYWRtaW4gPyBhZG1pbkF1dGggOiBhdXRoKTtcbiAgICAgICAgICAgIHZhciBwYXRoID0gb3B0cy5wYXRoIHx8ICcnO1xuICAgICAgICAgICAgaWYgKG9wdHMucGF0aCAhPSBudWxsKSBkZWxldGUgb3B0cy5wYXRoO1xuICAgICAgICAgICAgaWYgKCFvcHRzLnVybCkgb3B0cy51cmwgPSBfY29uc3RydWN0VVJMKHtwYXRoOiBwYXRofSk7XG4gICAgICAgICAgICBjb25zb2xlLmluZm8oJ1tDb3VjaERCOiBIVFRQIFJlcXVlc3RdOicsIG9wdHMpO1xuICAgICAgICAgICAgJC5hamF4KG9wdHMpLmRvbmUoZnVuY3Rpb24gKGRhdGEsIHRleHRTdGF0dXMsIGpxWEhSKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKCdbQ291Y2hEQjogSFRUUCBSZXNwb25zZV06Jywge1xuICAgICAgICAgICAgICAgICAgICBvcHRzOiBvcHRzLFxuICAgICAgICAgICAgICAgICAgICBqcVhIUjoganFYSFIsXG4gICAgICAgICAgICAgICAgICAgIHRleHRTdGF0dXM6IHRleHRTdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czoganFYSFIuc3RhdHVzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgY2IobnVsbCwgZGF0YSwganFYSFIpO1xuICAgICAgICAgICAgfSkuZmFpbChmdW5jdGlvbiAoanFYSFIsIHRleHRTdGF0dXMsIGVycm9yVGhyb3duKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5pbmZvKCdbQ291Y2hEQjogSFRUUCBSZXNwb25zZV06Jywge1xuICAgICAgICAgICAgICAgICAgICBvcHRzOiBvcHRzLFxuICAgICAgICAgICAgICAgICAgICBqcVhIUjoganFYSFIsXG4gICAgICAgICAgICAgICAgICAgIHRleHRTdGF0dXM6IHRleHRTdGF0dXMsXG4gICAgICAgICAgICAgICAgICAgIGVycm9yVGhyb3duOiBlcnJvclRocm93bixcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzOiBqcVhIUi5zdGF0dXNcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBpZiAoZXJyb3JUaHJvd24gaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBjYihuZXcgQ291Y2hFcnJvcih7dGhyb3duOiBlcnJvclRocm93bn0pKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiBlcnJvclRocm93biwgeGhyOiBqcVhIUiwgc3RhdHVzOiBqcVhIUi5zdGF0dXMsIG9wdHM6IG9wdHN9KSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogQmVzdCBlZmZvcnRzIGF0IGVuc3VyaW5nIHRoYXQgYSBzdHJpbmcgcmVwcmVzZW50cyBhIE1JTUUgdHlwZS5cbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IFtkYXRhVHlwZV1cbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIGVuc3VyZU1pbWVUeXBlKGRhdGFUeXBlKSB7XG4gICAgICAgICAgICBpZiAoZGF0YVR5cGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YVR5cGUudHJpbSgpID09ICdqc29uJykge1xuICAgICAgICAgICAgICAgICAgICBkYXRhVHlwZSA9IE1JTUUuSlNPTjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gZGF0YVR5cGU7XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogU2VuZCBhIGh0dHAgcmVxdWVzdCB1c2luZyBub2RlLiBTaGltcyBmcm9tIGpxdWVyeSBzdHlsZSBhamF4IG9wdHNcbiAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICogQHBhcmFtIG9wdHMudHlwZVxuICAgICAgICAgKiBAcGFyYW0gW29wdHMucGF0aF1cbiAgICAgICAgICogQHBhcmFtIFtvcHRzLnVybF0gLSBpZiB1cmwgaXMgcHJlc2VudCwgcGF0aCB3aWxsIGJlIGlnbm9yZWQhXG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5jb250ZW50VHlwZV0gLSBDb250ZW50IHR5cGUgb2YgZGF0YSBiZWluZyBzZW50XG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5kYXRhVHlwZV0gLSBFeHBlY3RlZCByZXNwb25zZSB0eXBlXG4gICAgICAgICAqIEBwYXJhbSBbb3B0cy5pZ25vcmVBdXRoXVxuICAgICAgICAgKiBAcGFyYW0gb3B0cy5kYXRhIC0gTXVzdCBiZSBhIHN0cmluZyBhdCB0aGUgbW9tZW50XG4gICAgICAgICAqIEBwYXJhbSBvcHRzLmFkbWluIC0gaWYgdHJ1ZSwgd2lsbCB1c2UgY29uZmlndXJlZCBhZG1pbiBjcmVkZW50aWFsc1xuICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIGZ1bmN0aW9uIF9uSHR0cChvcHRzLCBjYikge1xuICAgICAgICAgICAgY2IgPSBjYiB8fCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdmFyIHBhcnNlZFVSTDtcbiAgICAgICAgICAgIGlmIChvcHRzLnVybCkge1xuICAgICAgICAgICAgICAgIHBhcnNlZFVSTCA9IHVybC5wYXJzZShvcHRzLnVybCk7XG4gICAgICAgICAgICAgICAgLy8gQ2hlY2sgdGhhdCB0aGUgdXJsIHBhcmFtIHdhc250IGp1c3QgYSBwYXRoLi4uXG4gICAgICAgICAgICAgICAgaWYgKCFwYXJzZWRVUkwuaG9zdCkgcGFyc2VkVVJMID0gdXJsLnBhcnNlKF9jb25zdHJ1Y3RVUkwoe3BhdGg6IG9wdHMudXJsfSkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgcGFyc2VkVVJMID0gdXJsLnBhcnNlKF9jb25zdHJ1Y3RVUkwoe3BhdGg6IG9wdHMucGF0aCB8fCAnJ30pKVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGF0YSA9IG9wdHMuZGF0YSxcbiAgICAgICAgICAgICAgICByZXF1ZXN0VHlwZSA9ICdjb250ZW50VHlwZScgaW4gb3B0cyA/IG9wdHMuY29udGVudFR5cGUgOiBNSU1FLkpTT04sXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VUeXBlID0gZW5zdXJlTWltZVR5cGUob3B0cy5kYXRhVHlwZSksXG4gICAgICAgICAgICAgICAgbWV0aG9kID0gb3B0cy50eXBlIHx8ICdHRVQnO1xuXG4gICAgICAgICAgICB2YXIgaHR0cE9wdHMgPSB7XG4gICAgICAgICAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgICAgICAgICAgaG9zdG5hbWU6IHBhcnNlZFVSTC5ob3N0bmFtZSxcbiAgICAgICAgICAgICAgICBwb3J0OiBwYXJzZWRVUkwucG9ydCxcbiAgICAgICAgICAgICAgICBwYXRoOiBwYXJzZWRVUkwucGF0aFxuICAgICAgICAgICAgfTtcblxuXG4gICAgICAgICAgICBpZiAocmVxdWVzdFR5cGUpIHtcbiAgICAgICAgICAgICAgICBpZiAoZGF0YSkgZGF0YSA9IGNvZXJjZURhdGEocmVxdWVzdFR5cGUsIGRhdGEpO1xuICAgICAgICAgICAgICAgIGh0dHBPcHRzLmhlYWRlcnMgPSB7J2NvbnRlbnQtdHlwZSc6IHJlcXVlc3RUeXBlfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghb3B0cy5pZ25vcmVBdXRoKSBfY29uZmlndXJlQXV0aChodHRwT3B0cywgb3B0cy5hZG1pbiA/IGFkbWluQXV0aCA6IGF1dGgpO1xuICAgICAgICAgICAgdmFyIHJlcSA9IG5vZGVIdHRwLnJlcXVlc3QoaHR0cE9wdHMsIGZ1bmN0aW9uIChyZXMpIHtcbiAgICAgICAgICAgICAgICAvLyBPdmVycmlkZSB0byBwcmV2ZW50IGNpcmN1bGFyIEpTT04gZXJyb3JzLlxuICAgICAgICAgICAgICAgIHZhciByZXNwb25zZVN0cmluZyA9ICcnO1xuXG5cbiAgICAgICAgICAgICAgICByZXMub24oJ2RhdGEnLCBmdW5jdGlvbiAoY2h1bmspIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzcG9uc2VTdHJpbmcgKz0gY2h1bms7XG4gICAgICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgICAgICByZXMub24oJ2VuZCcsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHN0YXR1c0NvZGUgPSByZXMuc3RhdHVzQ29kZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGlzU3VjY2VzcyA9IHN0YXR1c0NvZGUgPj0gMjAwICYmIHN0YXR1c0NvZGUgPCAzMDA7XG4gICAgICAgICAgICAgICAgICAgIGlmIChpc1N1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBwYXJzZWRSZXNwb25zZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBfcmVzcG9uc2VUeXBlID0gKHJlc3BvbnNlVHlwZSB8fCByZXMuaGVhZGVyc1snY29udGVudC10eXBlJ10uc3BsaXQoJzsnKVswXSkudHJpbSgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKF9yZXNwb25zZVR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoX3Jlc3BvbnNlVHlwZSA9PSBNSU1FLkpTT04pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlZFJlc3BvbnNlID0gSlNPTi5wYXJzZShyZXNwb25zZVN0cmluZyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHt0aHJvd246IGV9KSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlZFJlc3BvbnNlID0gcmVzcG9uc2VTdHJpbmc7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZWRSZXNwb25zZSA9IHJlc3BvbnNlU3RyaW5nO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgY2IobnVsbCwgcGFyc2VkUmVzcG9uc2UsIHJlcyk7XG5cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHtyZXNwb25zZTogcmVzLCBzdGF0dXM6IHN0YXR1c0NvZGV9KSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICBpZiAoZGF0YSkgIHJlcS53cml0ZShkYXRhKTtcblxuICAgICAgICAgICAgcmVxLmVuZCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNlbmQgYSBIVFRQIHJlcXVlc3QuIFVzZXMgZWl0aGVyIGpxdWVyeSBvciBub2RlcyBodHRwIGRlcGVuZGluZyBvbiB3aGF0J3MgYXZhaWxhYmxlIGluIHRoZSBlbnZpcm9ubWVudFxuICAgICAgICAgKiBAcGFyYW0gb3B0cyAtIGpxdWVyeSBzdHlsZSBodHRwIG9wdHNcbiAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICBmdW5jdGlvbiBfaHR0cChvcHRzLCBjYikge1xuICAgICAgICAgICAgaWYgKG5vZGVIdHRwKSB7XG4gICAgICAgICAgICAgICAgX25IdHRwKG9wdHMsIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIF8kaHR0cChvcHRzLCBjYik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvKipcbiAgICAgICAgICogU2VuZCBhIEhUVFAgcmVxdWVzdCBvciBtdWx0aXBsZSBodHRwIHJlcXVlc3RzIGluIHBhcmFsbGVsXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fEFycmF5fSBvcHRzIC0gVGhlIHVzdWFsIGpxdWVyeSBvcHRzLCBvciBhbiBhcnJheSBvZiB0aGVtLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gW29wdHMucGF0aF0gLSBQYXRoIHRvIGFwcGVuZCB0byBob3N0XG4gICAgICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IFtjYl1cbiAgICAgICAgICovXG4gICAgICAgIHZhciBodHRwID0gZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShvcHRzKSkge1xuICAgICAgICAgICAgICAgIF8ucGFyYWxsZWwob3B0cy5tYXAoZnVuY3Rpb24gKF9vcHRzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmdW5jdGlvbiAoZG9uZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgX2h0dHAoX29wdHMsIGRvbmUpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSksIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIF9odHRwKG9wdHMsIGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBIHdyYXBwZXIgYXJvdW5kIFhNTEh0dHBSZXF1ZXN0LiBUaGlzIGV4aXN0cyBkdWUgdG8gc29tZSBzaG9ydC1jb21pbmdzIGluIGpxdWVyeSBhamF4IGFyb3VuZCBibG9icy5cbiAgICAgICAgICogSWYgd2UncmUgaW4gdGhlIE5vZGUgZW52aXJvbm1lbnQsIHRoaXMgd2lsbCBzaW1wbHkgcGFzcyBvbnRvIE5vZGUuXG4gICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAqIEBwYXJhbSBvcHRzLm1ldGhvZFxuICAgICAgICAgKiBAcGFyYW0gb3B0cy5yZXNwb25zZVR5cGVcbiAgICAgICAgICogQHBhcmFtIG9wdHMudXJsXG4gICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIF94aHJIdHRwID0gZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICB2YXIgbWV0aG9kID0gb3B0cy5tZXRob2QgfHwgJ0dFVCcsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2VUeXBlID0gb3B0cy5yZXNwb25zZVR5cGU7XG4gICAgICAgICAgICBjYiA9IGNiIHx8IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB2YXIgaW5Ob2RlRW52aXJvbm1lbnQgPSAhZ2xvYmFsWydYTUxIdHRwUmVxdWVzdCddO1xuICAgICAgICAgICAgaWYgKGluTm9kZUVudmlyb25tZW50KSB7XG4gICAgICAgICAgICAgICAgLy8gTm8gbmVlZCB0byB1c2UgWEhSXG4gICAgICAgICAgICAgICAgdmFyIG5vZGVIVFRQT3B0cyA9IHtcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBvcHRzLnVybCxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogbWV0aG9kXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAvLyBObyBjb25jZXB0IG9mIEhUTUw1IGJsb2IgaW4gTm9kZS5cbiAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2VUeXBlICE9ICdibG9iJykge1xuICAgICAgICAgICAgICAgICAgICBub2RlSFRUUE9wdHNbJ3Jlc3BvbnNlVHlwZSddID0gcmVzcG9uc2VUeXBlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBfbkh0dHAobm9kZUhUVFBPcHRzLCBjYik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB2YXIgWE1MSHR0cFJlcXVlc3QgPSBnbG9iYWxbJ1hNTEh0dHBSZXF1ZXN0J107XG4gICAgICAgICAgICAgICAgdmFyIHhociA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgICAgICAgICAgICAgIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLnJlYWR5U3RhdGUgPT0gNCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuc3RhdHVzID09IDIwMCkgY2IobnVsbCwgdGhpcy5yZXNwb25zZSwgeGhyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgY2IodGhpcy5zdGF0dXMsIHRoaXMucmVzcG9uc2UsIHhocik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHhoci5vcGVuKG1ldGhvZCwgb3B0cy51cmwpO1xuICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZVR5cGUpIHtcbiAgICAgICAgICAgICAgICAgICAgeGhyLnJlc3BvbnNlVHlwZSA9IHJlc3BvbnNlVHlwZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgeGhyLnNlbmQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogc2FtZSBhcyBodHRwIGV4Y2VwdCBkZWZhdWx0IHRvIGpzb25cbiAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAqL1xuICAgICAgICB2YXIganNvbiA9IGZ1bmN0aW9uIChvcHRzLCBjYikge1xuICAgICAgICAgICAgZnVuY3Rpb24gX2pzb24ob3B0cykge1xuICAgICAgICAgICAgICAgIG9wdHMuZGF0YVR5cGUgPSAnanNvbic7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KG9wdHMpKSB7XG4gICAgICAgICAgICAgICAgb3B0cy5mb3JFYWNoKF9qc29uKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIF9qc29uKG9wdHMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaHR0cChvcHRzLCBjYik7XG4gICAgICAgIH07XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENvdWNoREIgaGFzIGEgd2VpcmQgY29udmVudGlvbiBmb3IgdXNlciBpZGVudGlmaWVycy4gVGhpcyBmdW5jdGlvbiBzaW1wbHkgdHJhbnNmb3JtcyB0aGUgdXNlcm5hbWUgaW50b1xuICAgICAgICAgKiB0byBtYXRjaCB0aGF0IGNvbnZlbnRpb24uXG4gICAgICAgICAqIEBwYXJhbSB1c2VybmFtZVxuICAgICAgICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgKi9cbiAgICAgICAgZnVuY3Rpb24gX2dldEZ1bGx5UXVhbGlmZWRVc2VybmFtZSh1c2VybmFtZSkge1xuICAgICAgICAgICAgcmV0dXJuICdvcmcuY291Y2hkYi51c2VyOicgKyB1c2VybmFtZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgKiBAcGFyYW0gb3B0cy51c2VybmFtZVxuICAgICAgICAgKiBAcGFyYW0gb3B0cy5wYXNzd29yZFxuICAgICAgICAgKiBAcGFyYW0gb3B0cy5hdXRoIC0gdGhlIGF1dGggbWV0aG9kIHRvIHVzZVxuICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICovXG4gICAgICAgIHZhciBjcmVhdGVVc2VyID0gZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICB2YXIgdXNlcm5hbWUgPSBvcHRzLnVzZXJuYW1lLFxuICAgICAgICAgICAgICAgIHBhc3N3b3JkID0gb3B0cy5wYXNzd29yZDtcbiAgICAgICAgICAgIHZhciBmdWxseVF1YWxpZmllZFVzZXJuYW1lID0gX2dldEZ1bGx5UXVhbGlmZWRVc2VybmFtZSh1c2VybmFtZSk7XG4gICAgICAgICAgICBqc29uKHtcbiAgICAgICAgICAgICAgICBwYXRoOiAnX3VzZXJzLycgKyBmdWxseVF1YWxpZmllZFVzZXJuYW1lLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdQVVQnLFxuICAgICAgICAgICAgICAgIGRhdGE6IHtcbiAgICAgICAgICAgICAgICAgICAgX2lkOiBmdWxseVF1YWxpZmllZFVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICBuYW1lOiB1c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogJ3VzZXInLFxuICAgICAgICAgICAgICAgICAgICByb2xlczogW10sXG4gICAgICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBwYXNzd29yZFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgICAgICAgICAgICB2YXIgdXNlcjtcbiAgICAgICAgICAgICAgICBpZiAoIWVycikge1xuICAgICAgICAgICAgICAgICAgICB1c2VyID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgbmFtZTogdXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICB1c2VybmFtZTogdXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICBfaWQ6IHJlc3AuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICBfcmV2OiByZXNwLnJldlxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBpZiAob3B0cy5hdXRoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob3B0cy5hdXRoID09IEFVVEhfTUVUSE9ELkJBU0lDKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXV0aCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiBBVVRIX01FVEhPRC5CQVNJQyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlcm5hbWU6IHVzZXJuYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXNzd29yZDogcGFzc3dvcmQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXI6IHVzZXJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXIucGFzc3dvcmQgPSBwYXNzd29yZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiAnTllJOiBBdXRoIG1ldGhvZCBcIicgKyBvcHRzLmF1dGggKyAnXCInfSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNiKGVyciwgdXNlcik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIGZpcnN0IHRpbWUsIGFuIGFkbWluIHVzZXIgY2FuIGJlIGNyZWF0ZWQgd2l0aG91dCBhbnkgcGVybWlzc2lvbnMuIFN1YnNlcXVlbnRseSwgeW91IG11c3QgYXV0aGVudGljYXRlXG4gICAgICAgICAqIGFzIGFuIGFub3RoZXIgYWRtaW4gdXNlclxuICAgICAgICAgKiBAcGFyYW0gW2NiXVxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIGNyZWF0ZUFkbWluVXNlciA9IGZ1bmN0aW9uIChjYikge1xuICAgICAgICAgICAganNvbih7XG4gICAgICAgICAgICAgICAgcGF0aDogJ19jb25maWcvYWRtaW5zLycgKyBhZG1pbkF1dGgudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgdHlwZTogJ1BVVCcsXG4gICAgICAgICAgICAgICAgZGF0YTogJ1wiJyArIGFkbWluQXV0aC5wYXNzd29yZCArICdcIicsXG4gICAgICAgICAgICAgICAgYWRtaW46IHRydWVcbiAgICAgICAgICAgIH0sIGNiKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvKipcbiAgICAgICAgICogVmVyaWZ5IHRoYXQgdXNlcm5hbWUvcGFzc3dvcmQgY29tYmluYXRpb24gaXMgY29ycmVjdCBieSBoaXR0aW5nIHRoZSBfc2Vzc2lvbiBlbmRwb2ludC5cbiAgICAgICAgICogSWYgdGhpcyBpcyB0aGUgY2FzZSwgY29uZmlndXJlIGZ1dHVyZSBhdXRob3Jpc2F0aW9uIG1ldGhvZCBhY2NvcmRpbmdseS5cbiAgICAgICAgICogQHBhcmFtIGF1dGhPcHRzXG4gICAgICAgICAqIEBwYXJhbSBhdXRoT3B0cy51c2VybmFtZVxuICAgICAgICAgKiBAcGFyYW0gYXV0aE9wdHMucGFzc3dvcmRcbiAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAqL1xuICAgICAgICB2YXIgYmFzaWNBdXRoID0gZnVuY3Rpb24gKGF1dGhPcHRzLCBjYikge1xuICAgICAgICAgICAgdmFyIHVzZXJuYW1lID0gYXV0aE9wdHMudXNlcm5hbWUsXG4gICAgICAgICAgICAgICAgcGFzc3dvcmQgPSBhdXRoT3B0cy5wYXNzd29yZDtcbiAgICAgICAgICAgIHZhciBodHRwT3B0cyA9IHtcbiAgICAgICAgICAgICAgICBwYXRoOiAnX3Nlc3Npb24nLFxuICAgICAgICAgICAgICAgIHR5cGU6ICdQT1NUJyxcbiAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogXCJhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWRcIixcbiAgICAgICAgICAgICAgICBkYXRhOiAnbmFtZT0nICsgdXNlcm5hbWUgKyAnJnBhc3N3b3JkPScgKyBwYXNzd29yZFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGpzb24oaHR0cE9wdHMsIGZ1bmN0aW9uIChlcnIsIGRhdGEpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWVycikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZGF0YS5vaykge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXV0aCA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBtZXRob2Q6IEFVVEhfTUVUSE9ELkJBU0lDLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVzZXJuYW1lOiB1c2VybmFtZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXNzd29yZDogcGFzc3dvcmQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdXNlcjogZGF0YVxuICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEudXNlcm5hbWUgPSB1c2VybmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEucGFzc3dvcmQgPSBwYXNzd29yZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGEubmFtZSA9IHVzZXJuYW1lO1xuICAgICAgICAgICAgICAgICAgICAgICAgY2IobnVsbCwgZGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBjYihuZXcgQ291Y2hFcnJvcihkYXRhKSk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNiKGVycik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG5cblxuICAgICAgICAvKipcbiAgICAgICAgICogQWRtaW4gdXNlcnMgYXJlIGRpZmZlcmVudCB3aXRoIENvdWNoREIgYW5kIGRvbid0IGV4aXN0IHVuZGVyIHRoZSBub3JtYWwgX3VzZXJzIGRhdGFiYXNlLlxuICAgICAgICAgKiBAcGFyYW0gW2F1dGhPcHRzXVxuICAgICAgICAgKiBAcGFyYW0gW2F1dGhPcHRzLnVzZXJuYW1lXVxuICAgICAgICAgKiBAcGFyYW0gW2F1dGhPcHRzLnBhc3N3b3JkXVxuICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICovXG4gICAgICAgIHZhciBhZG1pbkxvZ2luID0gZnVuY3Rpb24gKGF1dGhPcHRzLCBjYikge1xuICAgICAgICAgICAgLy8gT25seSBhZG1pbnMgY2FuIHJlYWQgZ2xvYmFsIGNvbmZpZywgdGhlcmVmb3JlIHdlIHRlc3QgdGhhdCBjcmVkZW50aWFscyBhcmUgY29ycmVjdCBieSBxdWVyeWluZyB0aGF0XG4gICAgICAgICAgICAvLyBkYXRhYmFzZS5cbiAgICAgICAgICAgIGpzb24oe1xuICAgICAgICAgICAgICAgIHBhdGg6ICdfY29uZmlnJ1xuICAgICAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIGFkbWluQXV0aCA9IG1lcmdlKHt9LCBhdXRoT3B0cyk7XG4gICAgICAgICAgICAgICAgICAgIGFkbWluQXV0aC5tZXRob2QgPSBBVVRIX01FVEhPRC5CQVNJQztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuXG4gICAgICAgIGZ1bmN0aW9uIG9wdHNPckNhbGxiYWNrKG9wdHNPckNiLCBjYikge1xuICAgICAgICAgICAgdmFyIG9wdHM7XG4gICAgICAgICAgICBpZiAob3B0c09yQ2IgaW5zdGFuY2VvZiBGdW5jdGlvbikge1xuICAgICAgICAgICAgICAgIGNiID0gb3B0c09yQ2I7XG4gICAgICAgICAgICAgICAgb3B0cyA9IHt9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgb3B0cyA9IG9wdHNPckNiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtvcHRzOiBvcHRzLCBjYjogY2J9O1xuICAgICAgICB9XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFB1YmxpYyBBUEkgcHJvdmlkaW5nIGFjY2VzcyB0byB0aGUgYmFja2luZyBDb3VjaERCIGluc3RhbmNlLlxuICAgICAgICAgKi9cbiAgICAgICAgdmFyIEFQSTtcbiAgICAgICAgLy9ub2luc3BlY3Rpb24gSlNDb21tZW50TWF0Y2hlc1NpZ25hdHVyZSxKU0NvbW1lbnRNYXRjaGVzU2lnbmF0dXJlLEpTVmFsaWRhdGVKU0RvY1xuICAgICAgICBBUEkgPSB7XG4gICAgICAgICAgICBpbmZvOiBmdW5jdGlvbiAoY2IpIHtcbiAgICAgICAgICAgICAgICBqc29uKHtwYXRoOiAnJ30sIGNiKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjcmVhdGVVc2VyOiBjcmVhdGVVc2VyLFxuICAgICAgICAgICAgYmFzaWNBdXRoOiBiYXNpY0F1dGgsXG4gICAgICAgICAgICBhZG1pbkxvZ2luOiBhZG1pbkxvZ2luLFxuICAgICAgICAgICAgbG9nb3V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgYXV0aCA9IG51bGw7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgYWRtaW46IHtcbiAgICAgICAgICAgICAgICBjcmVhdGVBZG1pblVzZXI6IGNyZWF0ZUFkbWluVXNlcixcbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKiBDbGVhciBvdXQgdGhlIGRhdGFiYXNlLiBVc2VmdWwgZHVyaW5nIHRlc3RpbmcuXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYl1cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBkZWxldGVBbGxEYXRhYmFzZXM6IGZ1bmN0aW9uIChvcHRzT3JDYiwgY2IpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIF9fcmV0ID0gb3B0c09yQ2FsbGJhY2sob3B0c09yQ2IsIGNiKSxcbiAgICAgICAgICAgICAgICAgICAgICAgIG9wdHMgPSBfX3JldC5vcHRzO1xuICAgICAgICAgICAgICAgICAgICBjYiA9IF9fcmV0LmNiO1xuICAgICAgICAgICAgICAgICAgICBvcHRzLnBhdGggPSAnX2FsbF9kYnMnO1xuICAgICAgICAgICAgICAgICAgICBvcHRzLmFkbWluID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAganNvbihvcHRzLCBmdW5jdGlvbiAoZXJyLCBkYXRhKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXJyKSBjYihlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGFqYXhPcHRzID0gZGF0YS5yZWR1Y2UoZnVuY3Rpb24gKG1lbW8sIGRiTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIUlHTk9SRV9EQVRBQkFTRVMubWVtYmVyT2YoZGJOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWVtby5wdXNoKHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnREVMRVRFJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiBkYk5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRtaW46IHRydWVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBtZW1vO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sIFtdKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uKGFqYXhPcHRzLCBjYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKlxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBkb2NcbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLmlkXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLnJlbW92ZV1cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMuYWRtaW5dXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLmRhdGFiYXNlXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAgICAgICAgICovXG4gICAgICAgICAgICAgICAgX3RvZ2dsZURvYzogZnVuY3Rpb24gKGRvYywgb3B0cywgY2IpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGFiYXNlID0gb3B0cy5kYXRhYmFzZSB8fCBkZWZhdWx0REIsXG4gICAgICAgICAgICAgICAgICAgICAgICBpZCA9IG9wdHMuaWQsXG4gICAgICAgICAgICAgICAgICAgICAgICByZW1vdmUgPSBvcHRzLnJlbW92ZTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIHBhdGggPSBkYXRhYmFzZSArICcvJyArIGlkO1xuICAgICAgICAgICAgICAgICAgICBqc29uKG1lcmdlKHRydWUsIG9wdHMsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICBhZG1pbjogb3B0cy5hZG1pblxuICAgICAgICAgICAgICAgICAgICB9KSwgZnVuY3Rpb24gKGVyciwgcmVzcCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGZvdW5kID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoZXJyLnN0YXR1cyA9PSBBUEkuSFRUUF9TVEFUVVMuTk9UX0ZPVU5EKSBmb3VuZCA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJlbW92ZSAmJiBmb3VuZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGRlbGV0ZSBpdFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggKz0gJz9yZXY9JyArIHJlc3AuX3JldjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uKG1lcmdlKHRydWUsIG9wdHMsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkbWluOiBvcHRzLmFkbWluXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSksIGNiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIGVsc2UgaWYgKCFyZW1vdmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBjcmVhdGUgb3IgdXBkYXRlIGl0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGZvdW5kKSBkb2MuX3JldiA9IHJlc3AuX3JldjtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBqc29uKG1lcmdlKHRydWUsIG9wdHMsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdHlwZTogJ1BVVCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IGRvYyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYWRtaW46IG9wdHMuYWRtaW5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KSwgY2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gTm90aGluZyB0byBkbyFcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYihudWxsLCByZXNwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgICAgICogQ2xlYXIgb3V0IHRoZSBkYXRhYmFzZS4gVXNlZnVsIGR1cmluZyB0ZXN0aW5nLlxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2JdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi51c2VybmFtZV0gLSBhZG1pbiB1c2VybmFtZVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2IucGFzc3dvcmRdIC0gYWRtaW4gcGFzc3dvcmRcbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICByZXNldDogZnVuY3Rpb24gKG9wdHNPckNiLCBjYikge1xuICAgICAgICAgICAgICAgICAgICB2YXIgX19yZXQgPSBvcHRzT3JDYWxsYmFjayhvcHRzT3JDYiwgY2IpLFxuICAgICAgICAgICAgICAgICAgICAgICAgb3B0cyA9IF9fcmV0Lm9wdHM7XG4gICAgICAgICAgICAgICAgICAgIGNiID0gX19yZXQuY2I7XG4gICAgICAgICAgICAgICAgICAgIEFQSS5hZG1pbi5kZWxldGVBbGxEYXRhYmFzZXMob3B0cywgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFlcnIpIEFQSS5sb2dvdXQoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNiKGVycik7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKlxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c11cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMuYW5vbnltb3VzVXBkYXRlc11cbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMuYW5vbnltb3VzUmVhZHNdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtjYl1cbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBjb25maWd1cmVEYXRhYmFzZTogZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICAgICAgICAgIHZhciB0YXNrcyA9IFtdO1xuICAgICAgICAgICAgICAgICAgICBpZiAob3B0cy5hbm9ueW1vdXNVcGRhdGVzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGFza3MucHVzaChmdW5jdGlvbiAoZG9uZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhciBkb2MgPSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxhbmd1YWdlOiAnamF2YXNjcmlwdCcsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHZhbGlkYXRlX2RvY191cGRhdGU6IGZ1bmN0aW9uIChuZXdfZG9jLCBvbGRfZG9jLCB1c2VyQ3R4KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXVzZXJDdHgubmFtZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRocm93KHtmb3JiaWRkZW46IFwiTm90IEF1dGhvcml6ZWRcIn0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LnRvU3RyaW5nKClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIEFQSS5hZG1pbi5fdG9nZ2xlRG9jKGRvYywge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZDogJ19kZXNpZ24vYmxvY2tBbm9ueW1vdXNVcGRhdGVzJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcmVtb3ZlOiBvcHRzLmFub255bW91c1VwZGF0ZXMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkbWluOiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgZG9uZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBpZiAob3B0cy5hbm9ueW1vdXNSZWFkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRhc2tzLnB1c2goZnVuY3Rpb24gKGRvbmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YXIgZG9jID0ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBsYW5ndWFnZTogJ2phdmFzY3JpcHQnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB2YWxpZGF0ZV9kb2NfcmVhZDogZnVuY3Rpb24gKGRvYywgdXNlckN0eCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF1c2VyQ3R4Lm5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aHJvdyh7Zm9yYmlkZGVuOiBcIk5vdCBBdXRob3JpemVkXCJ9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfS50b1N0cmluZygpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBBUEkuYWRtaW4uX3RvZ2dsZURvYyhkb2MsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgaWQ6ICdfZGVzaWduL2Jsb2NrQW5vbnltb3VzUmVhZHMnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICByZW1vdmU6IG9wdHMuYW5vbnltb3VzUmVhZHMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFkbWluOiB0cnVlXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSwgZG9uZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBfLnBhcmFsbGVsKHRhc2tzLCBjYik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICwgLyoqXG4gICAgICAgICAgICAgICAgICpcbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2IuZGF0YWJhc2VdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi5hbm9ueW1vdXNVcGRhdGVzXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2IuYW5vbnltb3VzUmVhZHNdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtjYl1cbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBjcmVhdGVEYXRhYmFzZTogZnVuY3Rpb24gKG9wdHNPckNiLCBjYikge1xuICAgICAgICAgICAgICAgICAgICB2YXIgX19yZXQgPSBvcHRzT3JDYWxsYmFjayhvcHRzT3JDYiwgY2IpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgb3B0cyA9IF9fcmV0Lm9wdHM7XG4gICAgICAgICAgICAgICAgICAgIGNiID0gX19yZXQuY2I7XG4gICAgICAgICAgICAgICAgICAgIG9wdHMucGF0aCA9IG9wdHMuZGF0YWJhc2UgfHwgZGVmYXVsdERCO1xuICAgICAgICAgICAgICAgICAgICBvcHRzLnR5cGUgPSAnUFVUJztcbiAgICAgICAgICAgICAgICAgICAgb3B0cy5hZG1pbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGpzb24ob3B0cywgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmNvbmZpZ3VyZURhdGFiYXNlKG9wdHMsIGNiKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSBjYihlcnIpO1xuICAgICAgICAgICAgICAgICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAsXG5cbiAgICAgICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiXVxuICAgICAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c09yQ2IuZGF0YWJhc2VdXG4gICAgICAgICAgICAgICAgICogQHBhcmFtIFtjYl1cbiAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICBnZXRQZXJtaXNzaW9uczogZnVuY3Rpb24gKG9wdHNPckNiLCBjYikge1xuICAgICAgICAgICAgICAgICAgICB2YXIgX19yZXQgPSBvcHRzT3JDYWxsYmFjayhvcHRzT3JDYiwgY2IpO1xuICAgICAgICAgICAgICAgICAgICB2YXIgb3B0cyA9IF9fcmV0Lm9wdHM7XG4gICAgICAgICAgICAgICAgICAgIGNiID0gX19yZXQuY2I7XG4gICAgICAgICAgICAgICAgICAgIHZhciBkYXRhYmFzZSA9IG9wdHMuZGF0YWJhc2UgfHwgZGVmYXVsdERCO1xuICAgICAgICAgICAgICAgICAgICBvcHRzLnBhdGggPSBkYXRhYmFzZSArICcvX3NlY3VyaXR5JztcbiAgICAgICAgICAgICAgICAgICAgb3B0cy5hZG1pbiA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIGpzb24ob3B0cywgY2IpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIEhUVFBfU1RBVFVTOiB7XG4gICAgICAgICAgICAgICAgVU5BVVRIT1JJU0VEOiA0MDEsXG4gICAgICAgICAgICAgICAgQ09ORkxJQ1Q6IDQwOSxcbiAgICAgICAgICAgICAgICBOT1RfRk9VTkQ6IDQwNCxcbiAgICAgICAgICAgICAgICBGT1JCSURERU46IDQwM1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIEFVVEhfTUVUSE9EOiBBVVRIX01FVEhPRCxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogVmVyaWZ5IHRoYXQgdGhlIGNvbmZpZ3VyYXRpb24gaXMgb2suXG4gICAgICAgICAgICAgKiBAcGFyYW0gY2JcbiAgICAgICAgICAgICAqL1xuICAgICAgICAgICAgdmVyaWZ5OiBmdW5jdGlvbiAoY2IpIHtcbiAgICAgICAgICAgICAgICBqc29uKHtcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogZGVmYXVsdERCXG4gICAgICAgICAgICAgICAgfSwgY2IpO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgX3Vwc2VydERvY3VtZW50QXJndW1lbnRzOiBmdW5jdGlvbiAoYXJndW1lbnRzKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRvYywgb3B0cywgY2I7XG4gICAgICAgICAgICAgICAgaWYgKGlzT2JqZWN0KGFyZ3VtZW50c1swXSkgJiYgaXNPYmplY3QoYXJndW1lbnRzWzFdKSkge1xuICAgICAgICAgICAgICAgICAgICBkb2MgPSBhcmd1bWVudHNbMF07XG4gICAgICAgICAgICAgICAgICAgIG9wdHMgPSBhcmd1bWVudHNbMV07XG4gICAgICAgICAgICAgICAgICAgIGNiID0gYXJndW1lbnRzWzJdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChpc09iamVjdChhcmd1bWVudHNbMF0pKSB7XG4gICAgICAgICAgICAgICAgICAgIGRvYyA9IGFyZ3VtZW50c1swXTtcbiAgICAgICAgICAgICAgICAgICAgb3B0cyA9IHt9O1xuICAgICAgICAgICAgICAgICAgICBjYiA9IGFyZ3VtZW50c1sxXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGRvYyA9IHt9O1xuICAgICAgICAgICAgICAgICAgICBvcHRzID0ge307XG4gICAgICAgICAgICAgICAgICAgIGNiID0gYXJndW1lbnRzWzBdO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYiA9IGNiIHx8IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHJldHVybiB7ZG9jOiBkb2MsIG9wdHM6IG9wdHMsIGNiOiBjYn07XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKiBVcGRhdGVzIHNwZWNpYWwgZmllbGRzIGluIHRoZSBjb3VjaGRiIGRvYyBnaXZlbiBhIHJlc3BvbnNlIGZyb20gY291Y2hkYi5cbiAgICAgICAgICAgICAqIEBwYXJhbSBkb2NcbiAgICAgICAgICAgICAqIEBwYXJhbSByZXNwXG4gICAgICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgICAgICogQHJldHVybnMge3N0cmluZ3x1bmRlZmluZWR9IC0gdmFsaWRhdGlvbiBlcnJvciBpZiBhcHByb3ByaWF0ZVxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBfdXBkYXRlRG9jV2l0aFJlc3BvbnNlOiBmdW5jdGlvbiAoZG9jLCByZXNwKSB7XG4gICAgICAgICAgICAgICAgdmFyIG5ld2lkID0gcmVzcC5pZCxcbiAgICAgICAgICAgICAgICAgICAgbmV3cmV2ID0gcmVzcC5yZXY7XG4gICAgICAgICAgICAgICAgaWYgKCFuZXdpZCkgcmV0dXJuICdObyBpZCBpbiByZXNwb25zZSc7XG4gICAgICAgICAgICAgICAgaWYgKCFuZXdyZXYpIHJldHVybiAnTm8gcmV2IGluIHJlc3BvbnNlJztcbiAgICAgICAgICAgICAgICBkb2MuX2lkID0gbmV3aWQ7XG4gICAgICAgICAgICAgICAgZG9jLl9yZXYgPSBuZXdyZXY7XG4gICAgICAgICAgICB9LCAvKipcbiAgICAgICAgICAgICAqIENyZWF0ZXMgb3IgdXBkYXRlcyBhIGRvY3VtZW50LiBVc2VzIFBVVC9QT1NUIGFwcHJvcHJpYXRlbHkuXG4gICAgICAgICAgICAgKiBAcGFyYW0gW2RvY11cbiAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0c11cbiAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy5tZXJnZV0gLSBJZiByZXZpc2lvbiBkb2Vzbid0IG1hdGNoLCBhdXRvbWF0aWNhbGx5IG1lcmdlIHRoZSBkb2N1bWVudC5cbiAgICAgICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIHVwc2VydERvY3VtZW50OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSB0aGlzLl91cHNlcnREb2N1bWVudEFyZ3VtZW50cyhhcmd1bWVudHMpLFxuICAgICAgICAgICAgICAgICAgICBkb2MgPSBhcmdzLmRvYyxcbiAgICAgICAgICAgICAgICAgICAgb3B0cyA9IGFyZ3Mub3B0cyxcbiAgICAgICAgICAgICAgICAgICAgY2IgPSBhcmdzLmNiLFxuICAgICAgICAgICAgICAgICAgICBpZCwgcGF0aDtcbiAgICAgICAgICAgICAgICBpZiAoZG9jLl9pZCkge1xuICAgICAgICAgICAgICAgICAgICBpZCA9IGRvYy5faWQ7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHBhdGggPSBvcHRzLmRiIHx8IGRlZmF1bHREQjtcbiAgICAgICAgICAgICAgICBpZiAoaWQpIHBhdGggKz0gJy8nICsgaWQ7XG4gICAgICAgICAgICAgICAgaWYgKGF1dGgpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCd1c2VyJyBpbiBkb2MpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiAndGhlIHVzZXIgZmllbGQgaXMgcmVzZXJ2ZWQnfSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGRvYy51c2VyID0gYXV0aC51c2VyLm5hbWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGpzb24oe1xuICAgICAgICAgICAgICAgICAgICBwYXRoOiBwYXRoLFxuICAgICAgICAgICAgICAgICAgICBkYXRhOiBkb2MsXG4gICAgICAgICAgICAgICAgICAgIHR5cGU6IGlkID8gJ1BVVCcgOiAnUE9TVCdcbiAgICAgICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyLCByZXNwKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB2YXIgcHJvY2Vzc2VkRG9jID0gbWVyZ2Uoe30sIGRvYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlcnIgPSB0aGlzLl91cGRhdGVEb2NXaXRoUmVzcG9uc2UocHJvY2Vzc2VkRG9jLCByZXNwKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNiKGVyciwgcHJvY2Vzc2VkRG9jLCByZXNwKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBpc0NvbmZsaWN0ID0gZXJyLnN0YXR1cyA9PSBBUEkuSFRUUF9TVEFUVVMuQ09ORkxJQ1QsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgc2hvdWxkTWVyZ2UgPSBvcHRzLmNvbmZsaWN0cyA9PSAnbWVyZ2UnO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHNob3VsZE1lcmdlICYmIGlzQ29uZmxpY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBBUEkuX21lcmdlKGRvYywgb3B0cywgY2IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY2IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICAgICAgICB9LFxuXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICogV2lsbCByZXBlYXRlZGx5IGhpdCBDb3VjaERCIHVudGlsIGRvYyBoYXMgYmVlbiBtZXJnZWQgKGUuZy4gbm8gY29uZmxpY3QpXG4gICAgICAgICAgICAgKiBAcGFyYW0gZG9jXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAgICAgKiBAcHJpdmF0ZVxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBfbWVyZ2U6IGZ1bmN0aW9uIChkb2MsIG9wdHMsIGNiKSB7XG4gICAgICAgICAgICAgICAgQVBJLmdldERvY3VtZW50KGRvYy5faWQsIG9wdHMsIGZ1bmN0aW9uIChlcnIsIHJlc3ApIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlbGV0ZSBkb2MuX3JldjtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRvYyA9IG1lcmdlKHJlc3AsIGRvYyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBUcnkgYWdhaW4gbm93IHRoYXQgX3JldiBzaG91bGQgYmUgdXBkYXRlZC5cbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBzZXJ0RG9jdW1lbnQoZG9jLCBvcHRzLCBjYik7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBjYihlcnIpO1xuICAgICAgICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqIEdldCBkb2N1bWVudCB3aXRoIGlkXG4gICAgICAgICAgICAgKiBAcGFyYW0gX2lkXG4gICAgICAgICAgICAgKiBAcGFyYW0gW29wdHNPckNiXVxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzT3JDYi5kYXRhYmFzZV1cbiAgICAgICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGdldERvY3VtZW50OiBmdW5jdGlvbiAoX2lkLCBvcHRzT3JDYiwgY2IpIHtcbiAgICAgICAgICAgICAgICB2YXIgX19yZXQgPSBvcHRzT3JDYWxsYmFjayhvcHRzT3JDYiwgY2IpLFxuICAgICAgICAgICAgICAgICAgICBvcHRzID0gX19yZXQub3B0cztcbiAgICAgICAgICAgICAgICBjYiA9IF9fcmV0LmNiO1xuICAgICAgICAgICAgICAgIHZhciBkYXRhYmFzZSA9IG9wdHMuZGF0YWJhc2UgfHwgZGVmYXVsdERCO1xuICAgICAgICAgICAgICAgIGpzb24oe1xuICAgICAgICAgICAgICAgICAgICBwYXRoOiBkYXRhYmFzZSArICcvJyArIF9pZFxuICAgICAgICAgICAgICAgIH0sIGNiKTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIGdldFVzZXI6IGZ1bmN0aW9uICh1c2VybmFtZSwgY2IpIHtcbiAgICAgICAgICAgICAgICB2YXIgZnVsbHlRdWFsaWZpZWRVc2VybmFtZSA9IF9nZXRGdWxseVF1YWxpZmVkVXNlcm5hbWUodXNlcm5hbWUpO1xuICAgICAgICAgICAgICAgIGpzb24oe1xuICAgICAgICAgICAgICAgICAgICBwYXRoOiAnX3VzZXJzLycgKyBmdWxseVF1YWxpZmllZFVzZXJuYW1lXG4gICAgICAgICAgICAgICAgfSwgY2IpO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgLyoqXG4gICAgICAgICAgICAgKlxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHNcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLmRvYyAtIGEgZG9jdW1lbnQgd2l0aCBfaWQgb3IgYW4gc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIF9pZFxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuYXR0TmFtZSAtIG5hbWUgb2YgdGhlIGF0dGFjaG1lbnRcbiAgICAgICAgICAgICAqIEBwYXJhbSBbY2JdXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGdldEF0dGFjaG1lbnQ6IGZ1bmN0aW9uIChvcHRzLCBjYikge1xuICAgICAgICAgICAgICAgIHZhciBkYXRhYmFzZSA9IG9wdHMuZGIgfHwgZGVmYXVsdERCLFxuICAgICAgICAgICAgICAgICAgICBpZCA9IGlzU3RyaW5nKG9wdHMuZG9jKSA/IG9wdHMuZG9jIDogb3B0cy5kb2MuX2lkLFxuICAgICAgICAgICAgICAgICAgICBwYXRoID0gZGF0YWJhc2UgKyAnLycgKyBpZCArICcvJyArIG9wdHMuYXR0TmFtZTtcbiAgICAgICAgICAgICAgICBodHRwKHtcbiAgICAgICAgICAgICAgICAgICAgcGF0aDogcGF0aCxcbiAgICAgICAgICAgICAgICAgICAgY29udGVudFR5cGU6IG51bGxcbiAgICAgICAgICAgICAgICB9LCBjYik7XG4gICAgICAgICAgICB9LFxuXG4gICAgICAgICAgICAvKipcbiAgICAgICAgICAgICAqXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0c1xuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuZG9jIC0gYSBkb2N1bWVudCB3aXRoIF9pZCBvciBhbiBzdHJpbmcgcmVwcmVzZW50YXRpb24gb2YgX2lkXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0cy5hdHROYW1lIC0gbmFtZSBvZiB0aGUgYXR0YWNobWVudFxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLmRiXVxuICAgICAgICAgICAgICogQHBhcmFtIFtvcHRzLmRhdGFdIC0gcmF3IGJ5dGVzIHRvIHB1c2hcbiAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy51cmxdIC0gYWpheCBvcHRpb25zIHRvIGdldCBkYXRhXG4gICAgICAgICAgICAgKiBAcGFyYW0gW29wdHMubWltZVR5cGVdIC0gcmVxdWlyZWQgaWYgdXNlIGRhdGEgcGFyYW1ldGVyXG4gICAgICAgICAgICAgKiBAcGFyYW0gW2NiXVxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBwdXRBdHRhY2htZW50OiBmdW5jdGlvbiAob3B0cywgY2IpIHtcbiAgICAgICAgICAgICAgICBjYiA9IGNiIHx8IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIGlmIChvcHRzLmRhdGEpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFzc2VydE9wdGlvbnMoWydkYXRhJywgJ21pbWVUeXBlJywgJ2F0dE5hbWUnLCAnZG9jJ10sIG9wdHMsIGNiKS5sZW5ndGgpIHJldHVybjtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGFiYXNlID0gb3B0cy5kYiB8fCBkZWZhdWx0REIsXG4gICAgICAgICAgICAgICAgICAgICAgICBpZCA9IGlzU3RyaW5nKG9wdHMuZG9jKSA/IG9wdHMuZG9jIDogb3B0cy5kb2MuX2lkLFxuICAgICAgICAgICAgICAgICAgICAgICAgbWltZVR5cGUgPSBvcHRzLm1pbWVUeXBlIHx8IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgcmV2ID0gb3B0cy5kb2MuX3JldixcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGggPSBkYXRhYmFzZSArICcvJyArIGlkICsgJy8nICsgb3B0cy5hdHROYW1lO1xuICAgICAgICAgICAgICAgICAgICBpZiAocmV2KSBwYXRoICs9ICc/cmV2PScgKyByZXY7XG4gICAgICAgICAgICAgICAgICAgIHZhciBoZWFkZXJzID0gb3B0cy5oZWFkZXJzIHx8IHt9O1xuICAgICAgICAgICAgICAgICAgICAvL2hlYWRlcnNbJ0NvbnRlbnQtVHlwZSddID0gbWltZVR5cGU7XG4gICAgICAgICAgICAgICAgICAgIHZhciBodHRwT3B0cyA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBhdGg6IHBhdGgsXG4gICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnUFVUJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIGRhdGE6IG9wdHMuZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhY2hlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3NEYXRhOiBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRlbnRUeXBlOiBtaW1lVHlwZVxuICAgICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgICBodHRwT3B0cy5oZWFkZXJzID0gaGVhZGVycztcbiAgICAgICAgICAgICAgICAgICAgaHR0cChodHRwT3B0cywgY2IpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChvcHRzLnVybCkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoYXNzZXJ0T3B0aW9ucyhbJ3VybCcsICdhdHROYW1lJywgJ2RvYyddLCBvcHRzLCBjYikubGVuZ3RoKSByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgIC8qXG4gICAgICAgICAgICAgICAgICAgICBqcXVlcnkgYWpheCBkb2VzIG5vdCBzdXBwb3J0IGJsb2JzXG4gICAgICAgICAgICAgICAgICAgICBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzE3NjU3MTg0L3VzaW5nLWpxdWVyeXMtYWpheC1tZXRob2QtdG8tcmV0cmlldmUtaW1hZ2VzLWFzLWEtYmxvYlxuICAgICAgICAgICAgICAgICAgICAgZXZlbiBpZiBub3QgdXNpbmcgYmxvYiBrZXB0IGV4cGVyaWVuY2luZyBpc3N1ZXMgd2l0aCBjb3JydXB0aW9uIG9mIGltYWdlIGRhdGEuXG4gICAgICAgICAgICAgICAgICAgICBJdCdzIHByb2JhYmx5IHNvbWV0aGluZyB0byBkbyB3aXRoIGVuY29kaW5nIGJ1dCB3aWxsIFhIUiBmb3IgdGhpcyBmb3Igbm93LlxuICAgICAgICAgICAgICAgICAgICAgVE9ETzogVXNlIGpxdWVyeSBpbnN0ZWFkIGZvciB0aGUgYmVsb3cgKGlmIHBvc3NpYmxlKVxuICAgICAgICAgICAgICAgICAgICAgKi9cbiAgICAgICAgICAgICAgICAgICAgX3hockh0dHAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogb3B0cy51cmwsXG4gICAgICAgICAgICAgICAgICAgICAgICByZXNwb25zZVR5cGU6ICdibG9iJ1xuICAgICAgICAgICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyU3RhdHVzLCBkYXRhLCB4aHIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghZXJyU3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGRhdGFiYXNlID0gb3B0cy5kYiB8fCBkZWZhdWx0REIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlkID0gaXNTdHJpbmcob3B0cy5kb2MpID8gb3B0cy5kb2MgOiBvcHRzLmRvYy5faWQsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldiA9IG9wdHMuZG9jLl9yZXYsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1pbWVUeXBlID0gb3B0cy5taW1lVHlwZSB8fCBmYWxzZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcGF0aCA9IGRhdGFiYXNlICsgJy8nICsgaWQgKyAnLycgKyBvcHRzLmF0dE5hbWU7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHJldikgcGF0aCArPSAnP3Jldj0nICsgcmV2O1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGh0dHAoe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXRoOiBwYXRoLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0eXBlOiAnUFVUJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogZGF0YSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc0RhdGE6IGZhbHNlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50VHlwZTogbWltZVR5cGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LCBjYik7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjYihuZXcgQ291Y2hFcnJvcih7eGhyOiB4aHIsIHN0YXR1czogZXJyU3RhdHVzfSkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGNiKG5ldyBDb3VjaEVycm9yKHttZXNzYWdlOiAnTXVzdCBzcGVjaWZ5IGVpdGhlciBkYXRhIG9yIGFqYXgnfSkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICpcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0cy5kYXRhXG4gICAgICAgICAgICAgKiBAcGFyYW0gb3B0cy5taW1lVHlwZSxcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLmF0dE5hbWVcbiAgICAgICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBjb25zdHJ1Y3RBdHRhY2htZW50RnJvbVJhd0RhdGE6IGZ1bmN0aW9uIChvcHRzLCBjYikge1xuICAgICAgICAgICAgICAgIHZhciBhdHRhY2htZW50ID0ge307XG4gICAgICAgICAgICAgICAgYXR0YWNobWVudFtvcHRzLmF0dE5hbWVdID0ge1xuICAgICAgICAgICAgICAgICAgICAnY29udGVudC10eXBlJzogb3B0cy5taW1lVHlwZSxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogYnRvYShkYXRhKVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgY2IobnVsbCwgYXR0YWNobWVudClcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICpcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAgICAgKiBAcGFyYW0ge0Jsb2J9IG9wdHMuZGF0YSAtIGJsb2JcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLm1pbWVUeXBlLFxuICAgICAgICAgICAgICogQHBhcmFtIG9wdHMuYXR0TmFtZVxuICAgICAgICAgICAgICogQHBhcmFtIGNiXG4gICAgICAgICAgICAgKi9cbiAgICAgICAgICAgIGNvbnN0cnVjdEF0dGFjaG1lbnRGcm9tQmxvYjogZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICAgICAgdmFyIHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG4gICAgICAgICAgICAgICAgcmVhZGVyLm9ubG9hZGVuZCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGI2NCA9IHJlYWRlci5yZXN1bHQ7XG4gICAgICAgICAgICAgICAgICAgIHZhciBhdHRhY2htZW50ID0ge307XG4gICAgICAgICAgICAgICAgICAgIGF0dGFjaG1lbnRbb3B0cy5hdHROYW1lXSA9IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdjb250ZW50LXR5cGUnOiBvcHRzLm1pbWVUeXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgZGF0YTogYjY0XG4gICAgICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgICAgIGNiKG51bGwsIGF0dGFjaG1lbnQpO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgcmVhZGVyLm9uZXJyb3IgPSBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIGNiKGVycik7XG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICByZWFkZXIucmVhZEFzRGF0YVVSTChvcHRzLmRhdGEpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIC8qKlxuICAgICAgICAgICAgICpcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzXG4gICAgICAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gb3B0cy51cmwgLSBhIHVybCB0byBzb21ldGhpbmdcbiAgICAgICAgICAgICAqIEBwYXJhbSBvcHRzLmF0dE5hbWVcbiAgICAgICAgICAgICAqIEBwYXJhbSBbb3B0cy5taW1lVHlwZV1cbiAgICAgICAgICAgICAqIEBwYXJhbSBjYlxuICAgICAgICAgICAgICovXG4gICAgICAgICAgICBjb25zdHJ1Y3RBdHRhY2htZW50RnJvbVVSTDogZnVuY3Rpb24gKG9wdHMsIGNiKSB7XG4gICAgICAgICAgICAgICAgX3hockh0dHAoe1xuICAgICAgICAgICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgICAgICAgICByZXNwb25zZVR5cGU6ICdibG9iJyxcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBvcHRzLnVybFxuICAgICAgICAgICAgICAgIH0sIGZ1bmN0aW9uIChlcnJTdGF0dXMsIGRhdGEsIHhocikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoIWVyclN0YXR1cykge1xuICAgICAgICAgICAgICAgICAgICAgICAgb3B0cy5kYXRhID0gZGF0YTsgLy8gcmVzcG9uc2UgaXMgYSBCbG9iIG9iamVjdC5cbiAgICAgICAgICAgICAgICAgICAgICAgIEFQSS5jb25zdHJ1Y3RBdHRhY2htZW50RnJvbUJsb2Iob3B0cywgY2IpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2IobmV3IENvdWNoRXJyb3Ioe1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG1lc3NhZ2U6ICdFcnJvciBnZXR0aW5nIGF0dGFjaG1lbnQgZnJvbSBVUkw6ICcgKyBvcHRzLnVybCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB4aHI6IHhocixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGF0dXM6IGVyclN0YXR1c1xuICAgICAgICAgICAgICAgICAgICAgICAgfSkpXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoQVBJLCAnYXV0aCcsIHtcbiAgICAgICAgICAgIGdldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBhdXRoO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNldDogZnVuY3Rpb24gKF9hdXRoKSB7XG4gICAgICAgICAgICAgICAgYXV0aCA9IF9hdXRoXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29uZmlndXJhYmxlOiBmYWxzZSxcbiAgICAgICAgICAgIGVudW1lcmFibGU6IHRydWVcbiAgICAgICAgfSk7XG5cblxuICAgICAgICByZXR1cm4gQVBJO1xuXG4gICAgfTtcblxuICAgIGNvdWNoZGIuQVVUSF9NRVRIT0QgPSBBVVRIX01FVEhPRDtcbiAgICBjb3VjaGRiLkNvdWNoRXJyb3IgPSBDb3VjaEVycm9yO1xuXG4gICAgcm9vdC5jb3VjaGRiID0gY291Y2hkYjtcblxuXG59KSh0aGlzKTsiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIGtNYXhMZW5ndGggPSAweDNmZmZmZmZmXG52YXIgcm9vdFBhcmVudCA9IHt9XG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIE5vdGU6XG4gKlxuICogLSBJbXBsZW1lbnRhdGlvbiBtdXN0IHN1cHBvcnQgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMuXG4gKiAgIEZpcmVmb3ggNC0yOSBsYWNrZWQgc3VwcG9ydCwgZml4ZWQgaW4gRmlyZWZveCAzMCsuXG4gKiAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG4gKlxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXkgd2lsbFxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgd2lsbCB3b3JrIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSAoZnVuY3Rpb24gKCkge1xuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgcmV0dXJuIDQyID09PSBhcnIuZm9vKCkgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgbmV3IFVpbnQ4QXJyYXkoMSkuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcsIG5vWmVybykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQnVmZmVyKSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuXG4gIHZhciB0eXBlID0gdHlwZW9mIHN1YmplY3RcblxuICAvLyBGaW5kIHRoZSBsZW5ndGhcbiAgdmFyIGxlbmd0aFxuICBpZiAodHlwZSA9PT0gJ251bWJlcicpXG4gICAgbGVuZ3RoID0gc3ViamVjdCA+IDAgPyBzdWJqZWN0ID4+PiAwIDogMFxuICBlbHNlIGlmICh0eXBlID09PSAnc3RyaW5nJykge1xuICAgIGxlbmd0aCA9IEJ1ZmZlci5ieXRlTGVuZ3RoKHN1YmplY3QsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdvYmplY3QnICYmIHN1YmplY3QgIT09IG51bGwpIHsgLy8gYXNzdW1lIG9iamVjdCBpcyBhcnJheS1saWtlXG4gICAgaWYgKHN1YmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShzdWJqZWN0LmRhdGEpKVxuICAgICAgc3ViamVjdCA9IHN1YmplY3QuZGF0YVxuICAgIGxlbmd0aCA9ICtzdWJqZWN0Lmxlbmd0aCA+IDAgPyBNYXRoLmZsb29yKCtzdWJqZWN0Lmxlbmd0aCkgOiAwXG4gIH0gZWxzZVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4ga01heExlbmd0aClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byBhbGxvY2F0ZSBCdWZmZXIgbGFyZ2VyIHRoYW4gbWF4aW11bSAnICtcbiAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoLnRvU3RyaW5nKDE2KSArICcgYnl0ZXMnKVxuXG4gIHZhciBidWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUHJlZmVycmVkOiBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIGJ1ZiA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gVEhJUyBpbnN0YW5jZSBvZiBCdWZmZXIgKGNyZWF0ZWQgYnkgYG5ld2ApXG4gICAgYnVmID0gdGhpc1xuICAgIGJ1Zi5sZW5ndGggPSBsZW5ndGhcbiAgICBidWYuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIHR5cGVvZiBzdWJqZWN0LmJ5dGVMZW5ndGggPT09ICdudW1iZXInKSB7XG4gICAgLy8gU3BlZWQgb3B0aW1pemF0aW9uIC0tIHVzZSBzZXQgaWYgd2UncmUgY29weWluZyBmcm9tIGEgdHlwZWQgYXJyYXlcbiAgICBidWYuX3NldChzdWJqZWN0KVxuICB9IGVsc2UgaWYgKGlzQXJyYXlpc2goc3ViamVjdCkpIHtcbiAgICAvLyBUcmVhdCBhcnJheS1pc2ggb2JqZWN0cyBhcyBhIGJ5dGUgYXJyYXlcbiAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpKSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspXG4gICAgICAgIGJ1ZltpXSA9IHN1YmplY3QucmVhZFVJbnQ4KGkpXG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKylcbiAgICAgICAgYnVmW2ldID0gKChzdWJqZWN0W2ldICUgMjU2KSArIDI1NikgJSAyNTZcbiAgICB9XG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpIHtcbiAgICBidWYud3JpdGUoc3ViamVjdCwgMCwgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ251bWJlcicgJiYgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmICFub1plcm8pIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIGJ1ZltpXSA9IDBcbiAgICB9XG4gIH1cblxuICBpZiAobGVuZ3RoID4gMCAmJiBsZW5ndGggPD0gQnVmZmVyLnBvb2xTaXplKVxuICAgIGJ1Zi5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIGJ1ZlxufVxuXG5mdW5jdGlvbiBTbG93QnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKVxuICAgIHJldHVybiBuZXcgU2xvd0J1ZmZlcihzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKVxuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyBtdXN0IGJlIEJ1ZmZlcnMnKVxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gTWF0aC5taW4oeCwgeSk7IGkgPCBsZW4gJiYgYVtpXSA9PT0gYltpXTsgaSsrKSB7fVxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVc2FnZTogQnVmZmVyLmNvbmNhdChsaXN0WywgbGVuZ3RoXSknKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKHRvdGFsTGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICB0b3RhbExlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgdG90YWxMZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcih0b3RhbExlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIChzdHIsIGVuY29kaW5nKSB7XG4gIHZhciByZXRcbiAgc3RyID0gc3RyICsgJydcbiAgc3dpdGNoIChlbmNvZGluZyB8fCAndXRmOCcpIHtcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdyYXcnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCAqIDJcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggPj4+IDFcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IGJhc2U2NFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbi8vIHByZS1zZXQgZm9yIHZhbHVlcyB0aGF0IG1heSBleGlzdCBpbiB0aGUgZnV0dXJlXG5CdWZmZXIucHJvdG90eXBlLmxlbmd0aCA9IHVuZGVmaW5lZFxuQnVmZmVyLnByb3RvdHlwZS5wYXJlbnQgPSB1bmRlZmluZWRcblxuLy8gdG9TdHJpbmcoZW5jb2RpbmcsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uIChlbmNvZGluZywgc3RhcnQsIGVuZCkge1xuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuXG4gIHN0YXJ0ID0gc3RhcnQgPj4+IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kID4+PiAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKVxuICAgICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpXG4gICAgICBzdHIgKz0gJyAuLi4gJ1xuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgc3RyICsgJz4nXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29tcGFyZSA9IGZ1bmN0aW9uIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpXG59XG5cbi8vIGBnZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBieXRlID0gcGFyc2VJbnQoc3RyaW5nLnN1YnN0cihpICogMiwgMiksIDE2KVxuICAgIGlmIChpc05hTihieXRlKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IGJ5dGVcbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiB1dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gdXRmMTZsZVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aCwgMilcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGhcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG5cbiAgaWYgKGxlbmd0aCA8IDAgfHwgb2Zmc2V0IDwgMCB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignYXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKTtcblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKClcblxuICB2YXIgcmV0XG4gIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldCA9IGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gdXRmMTZsZVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIHtcbiAgICB0eXBlOiAnQnVmZmVyJyxcbiAgICBkYXRhOiBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCh0aGlzLl9hcnIgfHwgdGhpcywgMClcbiAgfVxufVxuXG5mdW5jdGlvbiBiYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gdXRmOFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJlcyA9ICcnXG4gIHZhciB0bXAgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBpZiAoYnVmW2ldIDw9IDB4N0YpIHtcbiAgICAgIHJlcyArPSBkZWNvZGVVdGY4Q2hhcih0bXApICsgU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gICAgICB0bXAgPSAnJ1xuICAgIH0gZWxzZSB7XG4gICAgICB0bXAgKz0gJyUnICsgYnVmW2ldLnRvU3RyaW5nKDE2KVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXMgKyBkZWNvZGVVdGY4Q2hhcih0bXApXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlbjtcbiAgICBpZiAoc3RhcnQgPCAwKVxuICAgICAgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApXG4gICAgICBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpXG4gICAgZW5kID0gc3RhcnRcblxuICB2YXIgbmV3QnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIG5ld0J1ZiA9IEJ1ZmZlci5fYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkLCB0cnVlKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9XG5cbiAgaWYgKG5ld0J1Zi5sZW5ndGgpXG4gICAgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKVxuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKVxuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdUcnlpbmcgdG8gYWNjZXNzIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludExFID0gZnVuY3Rpb24gKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludEJFID0gZnVuY3Rpb24gKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdICogbXVsO1xuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gKiAweDEwMDAwMDApICtcbiAgICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICAgdGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKVxuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpXG4gICAgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50QkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aFxuICB2YXIgbXVsID0gMVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWldXG4gIHdoaWxlIChpID4gMCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWldICogbXVsXG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpXG4gICAgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpXG4gICAgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KVxuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdidWZmZXIgbXVzdCBiZSBhIEJ1ZmZlciBpbnN0YW5jZScpXG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpXG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgPj4+IDAgJiAweEZGXG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSA+Pj4gMCAmIDB4RkZcblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSW50KHRoaXMsXG4gICAgICAgICAgICAgdmFsdWUsXG4gICAgICAgICAgICAgb2Zmc2V0LFxuICAgICAgICAgICAgIGJ5dGVMZW5ndGgsXG4gICAgICAgICAgICAgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKSAtIDEsXG4gICAgICAgICAgICAgLU1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSkpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSlcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludEJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJbnQodGhpcyxcbiAgICAgICAgICAgICB2YWx1ZSxcbiAgICAgICAgICAgICBvZmZzZXQsXG4gICAgICAgICAgICAgYnl0ZUxlbmd0aCxcbiAgICAgICAgICAgICBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpIC0gMSxcbiAgICAgICAgICAgICAtTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKSlcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKVxuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Ugb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9IHZhbHVlXG4gIH0gZWxzZSBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydClcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uICh0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICB2YXIgc291cmNlID0gdGhpc1xuXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXRfc3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0X3N0YXJ0ID0gdGFyZ2V0Lmxlbmd0aFxuICBpZiAoIXRhcmdldF9zdGFydCkgdGFyZ2V0X3N0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHNvdXJjZS5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAodGFyZ2V0X3N0YXJ0IDwgMClcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gc291cmNlLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpXG4gICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgPCBlbmQgLSBzdGFydClcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0ICsgc3RhcnRcblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldF9zdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGFyZ2V0Ll9zZXQodGhpcy5zdWJhcnJheShzdGFydCwgc3RhcnQgKyBsZW4pLCB0YXJnZXRfc3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAgIHJldHVybiAobmV3IEJ1ZmZlcih0aGlzKSkuYnVmZmVyXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aClcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBidWYubGVuZ3RoOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgfVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQnVmZmVyLnRvQXJyYXlCdWZmZXIgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGJyb3dzZXInKVxuICB9XG59XG5cbi8vIEhFTFBFUiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT1cblxudmFyIEJQID0gQnVmZmVyLnByb3RvdHlwZVxuXG4vKipcbiAqIEF1Z21lbnQgYSBVaW50OEFycmF5ICppbnN0YW5jZSogKG5vdCB0aGUgVWludDhBcnJheSBjbGFzcyEpIHdpdGggQnVmZmVyIG1ldGhvZHNcbiAqL1xuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gKGFycikge1xuICBhcnIuY29uc3RydWN0b3IgPSBCdWZmZXJcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IGdldC9zZXQgbWV0aG9kcyBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9nZXQgPSBhcnIuZ2V0XG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmVxdWFscyA9IEJQLmVxdWFsc1xuICBhcnIuY29tcGFyZSA9IEJQLmNvbXBhcmVcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludExFID0gQlAucmVhZFVJbnRMRVxuICBhcnIucmVhZFVJbnRCRSA9IEJQLnJlYWRVSW50QkVcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50TEUgPSBCUC5yZWFkSW50TEVcbiAgYXJyLnJlYWRJbnRCRSA9IEJQLnJlYWRJbnRCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnRMRSA9IEJQLndyaXRlVUludExFXG4gIGFyci53cml0ZVVJbnRCRSA9IEJQLndyaXRlVUludEJFXG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnRMRSA9IEJQLndyaXRlSW50TEVcbiAgYXJyLndyaXRlSW50QkUgPSBCUC53cml0ZUludEJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtelxcLV0vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgY29udmVydHMgc3RyaW5ncyB3aXRoIGxlbmd0aCA8IDIgdG8gJydcbiAgaWYgKHN0ci5sZW5ndGggPCAyKSByZXR1cm4gJydcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gaXNBcnJheWlzaCAoc3ViamVjdCkge1xuICByZXR1cm4gaXNBcnJheShzdWJqZWN0KSB8fCBCdWZmZXIuaXNCdWZmZXIoc3ViamVjdCkgfHxcbiAgICAgIHN1YmplY3QgJiYgdHlwZW9mIHN1YmplY3QgPT09ICdvYmplY3QnICYmXG4gICAgICB0eXBlb2Ygc3ViamVjdC5sZW5ndGggPT09ICdudW1iZXInXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMoc3RyaW5nLCB1bml0cykge1xuICB2YXIgY29kZVBvaW50LCBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBieXRlcyA9IFtdXG4gIHZhciBpID0gMFxuXG4gIGZvciAoOyBpPGxlbmd0aDsgaSsrKSB7XG4gICAgY29kZVBvaW50ID0gc3RyaW5nLmNoYXJDb2RlQXQoaSlcblxuICAgIC8vIGlzIHN1cnJvZ2F0ZSBjb21wb25lbnRcbiAgICBpZiAoY29kZVBvaW50ID4gMHhEN0ZGICYmIGNvZGVQb2ludCA8IDB4RTAwMCkge1xuXG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKGxlYWRTdXJyb2dhdGUpIHtcblxuICAgICAgICAvLyAyIGxlYWRzIGluIGEgcm93XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZhbGlkIHN1cnJvZ2F0ZSBwYWlyXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBubyBsZWFkIHlldFxuICAgICAgZWxzZSB7XG5cbiAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gdmFsaWQgYm1wIGNoYXIsIGJ1dCBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgIGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICB9XG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH1cbiAgICBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDgwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2IHwgMHhDMCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgICk7XG4gICAgfVxuICAgIGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyB8IDB4RTAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgICk7XG4gICAgfVxuICAgIGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4MjAwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDQpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDEyIHwgMHhGMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4QyAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBjb2RlIHBvaW50JylcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnl0ZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgLy8gTm9kZSdzIGNvZGUgc2VlbXMgdG8gYmUgZG9pbmcgdGhpcyBhbmQgbm90ICYgMHg3Ri4uXG4gICAgYnl0ZUFycmF5LnB1c2goc3RyLmNoYXJDb2RlQXQoaSkgJiAweEZGKVxuICB9XG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVRvQnl0ZXMgKHN0ciwgdW5pdHMpIHtcbiAgdmFyIGMsIGhpLCBsb1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcblxuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoYmFzZTY0Y2xlYW4oc3RyKSlcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoLCB1bml0U2l6ZSkge1xuICBpZiAodW5pdFNpemUpIGxlbmd0aCAtPSBsZW5ndGggJSB1bml0U2l6ZTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSlcbiAgICAgIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gZGVjb2RlVXRmOENoYXIgKHN0cikge1xuICB0cnkge1xuICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQoc3RyKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZSgweEZGRkQpIC8vIFVURiA4IGludmFsaWQgY2hhclxuICB9XG59XG4iLCJ2YXIgbG9va3VwID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuXG47KGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cdCd1c2Ugc3RyaWN0JztcblxuICB2YXIgQXJyID0gKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJylcbiAgICA/IFVpbnQ4QXJyYXlcbiAgICA6IEFycmF5XG5cblx0dmFyIFBMVVMgICA9ICcrJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSCAgPSAnLycuY2hhckNvZGVBdCgwKVxuXHR2YXIgTlVNQkVSID0gJzAnLmNoYXJDb2RlQXQoMClcblx0dmFyIExPV0VSICA9ICdhJy5jaGFyQ29kZUF0KDApXG5cdHZhciBVUFBFUiAgPSAnQScuY2hhckNvZGVBdCgwKVxuXHR2YXIgUExVU19VUkxfU0FGRSA9ICctJy5jaGFyQ29kZUF0KDApXG5cdHZhciBTTEFTSF9VUkxfU0FGRSA9ICdfJy5jaGFyQ29kZUF0KDApXG5cblx0ZnVuY3Rpb24gZGVjb2RlIChlbHQpIHtcblx0XHR2YXIgY29kZSA9IGVsdC5jaGFyQ29kZUF0KDApXG5cdFx0aWYgKGNvZGUgPT09IFBMVVMgfHxcblx0XHQgICAgY29kZSA9PT0gUExVU19VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MiAvLyAnKydcblx0XHRpZiAoY29kZSA9PT0gU0xBU0ggfHxcblx0XHQgICAgY29kZSA9PT0gU0xBU0hfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjMgLy8gJy8nXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIpXG5cdFx0XHRyZXR1cm4gLTEgLy9ubyBtYXRjaFxuXHRcdGlmIChjb2RlIDwgTlVNQkVSICsgMTApXG5cdFx0XHRyZXR1cm4gY29kZSAtIE5VTUJFUiArIDI2ICsgMjZcblx0XHRpZiAoY29kZSA8IFVQUEVSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIFVQUEVSXG5cdFx0aWYgKGNvZGUgPCBMT1dFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBMT1dFUiArIDI2XG5cdH1cblxuXHRmdW5jdGlvbiBiNjRUb0J5dGVBcnJheSAoYjY0KSB7XG5cdFx0dmFyIGksIGosIGwsIHRtcCwgcGxhY2VIb2xkZXJzLCBhcnJcblxuXHRcdGlmIChiNjQubGVuZ3RoICUgNCA+IDApIHtcblx0XHRcdHRocm93IG5ldyBFcnJvcignSW52YWxpZCBzdHJpbmcuIExlbmd0aCBtdXN0IGJlIGEgbXVsdGlwbGUgb2YgNCcpXG5cdFx0fVxuXG5cdFx0Ly8gdGhlIG51bWJlciBvZiBlcXVhbCBzaWducyAocGxhY2UgaG9sZGVycylcblx0XHQvLyBpZiB0aGVyZSBhcmUgdHdvIHBsYWNlaG9sZGVycywgdGhhbiB0aGUgdHdvIGNoYXJhY3RlcnMgYmVmb3JlIGl0XG5cdFx0Ly8gcmVwcmVzZW50IG9uZSBieXRlXG5cdFx0Ly8gaWYgdGhlcmUgaXMgb25seSBvbmUsIHRoZW4gdGhlIHRocmVlIGNoYXJhY3RlcnMgYmVmb3JlIGl0IHJlcHJlc2VudCAyIGJ5dGVzXG5cdFx0Ly8gdGhpcyBpcyBqdXN0IGEgY2hlYXAgaGFjayB0byBub3QgZG8gaW5kZXhPZiB0d2ljZVxuXHRcdHZhciBsZW4gPSBiNjQubGVuZ3RoXG5cdFx0cGxhY2VIb2xkZXJzID0gJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDIpID8gMiA6ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAxKSA/IDEgOiAwXG5cblx0XHQvLyBiYXNlNjQgaXMgNC8zICsgdXAgdG8gdHdvIGNoYXJhY3RlcnMgb2YgdGhlIG9yaWdpbmFsIGRhdGFcblx0XHRhcnIgPSBuZXcgQXJyKGI2NC5sZW5ndGggKiAzIC8gNCAtIHBsYWNlSG9sZGVycylcblxuXHRcdC8vIGlmIHRoZXJlIGFyZSBwbGFjZWhvbGRlcnMsIG9ubHkgZ2V0IHVwIHRvIHRoZSBsYXN0IGNvbXBsZXRlIDQgY2hhcnNcblx0XHRsID0gcGxhY2VIb2xkZXJzID4gMCA/IGI2NC5sZW5ndGggLSA0IDogYjY0Lmxlbmd0aFxuXG5cdFx0dmFyIEwgPSAwXG5cblx0XHRmdW5jdGlvbiBwdXNoICh2KSB7XG5cdFx0XHRhcnJbTCsrXSA9IHZcblx0XHR9XG5cblx0XHRmb3IgKGkgPSAwLCBqID0gMDsgaSA8IGw7IGkgKz0gNCwgaiArPSAzKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDE4KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDEyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpIDw8IDYpIHwgZGVjb2RlKGI2NC5jaGFyQXQoaSArIDMpKVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwMDApID4+IDE2KVxuXHRcdFx0cHVzaCgodG1wICYgMHhGRjAwKSA+PiA4KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdGlmIChwbGFjZUhvbGRlcnMgPT09IDIpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA+PiA0KVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH0gZWxzZSBpZiAocGxhY2VIb2xkZXJzID09PSAxKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDEwKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpIDw8IDQpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPj4gMilcblx0XHRcdHB1c2goKHRtcCA+PiA4KSAmIDB4RkYpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0cmV0dXJuIGFyclxuXHR9XG5cblx0ZnVuY3Rpb24gdWludDhUb0Jhc2U2NCAodWludDgpIHtcblx0XHR2YXIgaSxcblx0XHRcdGV4dHJhQnl0ZXMgPSB1aW50OC5sZW5ndGggJSAzLCAvLyBpZiB3ZSBoYXZlIDEgYnl0ZSBsZWZ0LCBwYWQgMiBieXRlc1xuXHRcdFx0b3V0cHV0ID0gXCJcIixcblx0XHRcdHRlbXAsIGxlbmd0aFxuXG5cdFx0ZnVuY3Rpb24gZW5jb2RlIChudW0pIHtcblx0XHRcdHJldHVybiBsb29rdXAuY2hhckF0KG51bSlcblx0XHR9XG5cblx0XHRmdW5jdGlvbiB0cmlwbGV0VG9CYXNlNjQgKG51bSkge1xuXHRcdFx0cmV0dXJuIGVuY29kZShudW0gPj4gMTggJiAweDNGKSArIGVuY29kZShudW0gPj4gMTIgJiAweDNGKSArIGVuY29kZShudW0gPj4gNiAmIDB4M0YpICsgZW5jb2RlKG51bSAmIDB4M0YpXG5cdFx0fVxuXG5cdFx0Ly8gZ28gdGhyb3VnaCB0aGUgYXJyYXkgZXZlcnkgdGhyZWUgYnl0ZXMsIHdlJ2xsIGRlYWwgd2l0aCB0cmFpbGluZyBzdHVmZiBsYXRlclxuXHRcdGZvciAoaSA9IDAsIGxlbmd0aCA9IHVpbnQ4Lmxlbmd0aCAtIGV4dHJhQnl0ZXM7IGkgPCBsZW5ndGg7IGkgKz0gMykge1xuXHRcdFx0dGVtcCA9ICh1aW50OFtpXSA8PCAxNikgKyAodWludDhbaSArIDFdIDw8IDgpICsgKHVpbnQ4W2kgKyAyXSlcblx0XHRcdG91dHB1dCArPSB0cmlwbGV0VG9CYXNlNjQodGVtcClcblx0XHR9XG5cblx0XHQvLyBwYWQgdGhlIGVuZCB3aXRoIHplcm9zLCBidXQgbWFrZSBzdXJlIHRvIG5vdCBmb3JnZXQgdGhlIGV4dHJhIGJ5dGVzXG5cdFx0c3dpdGNoIChleHRyYUJ5dGVzKSB7XG5cdFx0XHRjYXNlIDE6XG5cdFx0XHRcdHRlbXAgPSB1aW50OFt1aW50OC5sZW5ndGggLSAxXVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPT0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0XHRjYXNlIDI6XG5cdFx0XHRcdHRlbXAgPSAodWludDhbdWludDgubGVuZ3RoIC0gMl0gPDwgOCkgKyAodWludDhbdWludDgubGVuZ3RoIC0gMV0pXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAxMClcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA+PiA0KSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgMikgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz0nXG5cdFx0XHRcdGJyZWFrXG5cdFx0fVxuXG5cdFx0cmV0dXJuIG91dHB1dFxuXHR9XG5cblx0ZXhwb3J0cy50b0J5dGVBcnJheSA9IGI2NFRvQnl0ZUFycmF5XG5cdGV4cG9ydHMuZnJvbUJ5dGVBcnJheSA9IHVpbnQ4VG9CYXNlNjRcbn0odHlwZW9mIGV4cG9ydHMgPT09ICd1bmRlZmluZWQnID8gKHRoaXMuYmFzZTY0anMgPSB7fSkgOiBleHBvcnRzKSlcbiIsImV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sXG4gICAgICBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxLFxuICAgICAgZU1heCA9ICgxIDw8IGVMZW4pIC0gMSxcbiAgICAgIGVCaWFzID0gZU1heCA+PiAxLFxuICAgICAgbkJpdHMgPSAtNyxcbiAgICAgIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMCxcbiAgICAgIGQgPSBpc0xFID8gLTEgOiAxLFxuICAgICAgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXTtcblxuICBpICs9IGQ7XG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSk7XG4gIHMgPj49ICgtbkJpdHMpO1xuICBuQml0cyArPSBlTGVuO1xuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KTtcblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgZSA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IG1MZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhcztcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpO1xuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbik7XG4gICAgZSA9IGUgLSBlQmlhcztcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKTtcbn07XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbihidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgYyxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMCksXG4gICAgICBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSksXG4gICAgICBkID0gaXNMRSA/IDEgOiAtMSxcbiAgICAgIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDA7XG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSk7XG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDA7XG4gICAgZSA9IGVNYXg7XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpO1xuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLTtcbiAgICAgIGMgKj0gMjtcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKTtcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKys7XG4gICAgICBjIC89IDI7XG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMDtcbiAgICAgIGUgPSBlTWF4O1xuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSBlICsgZUJpYXM7XG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICAgIGUgPSAwO1xuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpO1xuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG07XG4gIGVMZW4gKz0gbUxlbjtcbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KTtcblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjg7XG59O1xuIiwiXG4vKipcbiAqIGlzQXJyYXlcbiAqL1xuXG52YXIgaXNBcnJheSA9IEFycmF5LmlzQXJyYXk7XG5cbi8qKlxuICogdG9TdHJpbmdcbiAqL1xuXG52YXIgc3RyID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBXaGV0aGVyIG9yIG5vdCB0aGUgZ2l2ZW4gYHZhbGBcbiAqIGlzIGFuIGFycmF5LlxuICpcbiAqIGV4YW1wbGU6XG4gKlxuICogICAgICAgIGlzQXJyYXkoW10pO1xuICogICAgICAgIC8vID4gdHJ1ZVxuICogICAgICAgIGlzQXJyYXkoYXJndW1lbnRzKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKiAgICAgICAgaXNBcnJheSgnJyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICpcbiAqIEBwYXJhbSB7bWl4ZWR9IHZhbFxuICogQHJldHVybiB7Ym9vbH1cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGlzQXJyYXkgfHwgZnVuY3Rpb24gKHZhbCkge1xuICByZXR1cm4gISEgdmFsICYmICdbb2JqZWN0IEFycmF5XScgPT0gc3RyLmNhbGwodmFsKTtcbn07XG4iLCIvKiFcclxuICogQG5hbWUgSmF2YVNjcmlwdC9Ob2RlSlMgTWVyZ2UgdjEuMi4wXHJcbiAqIEBhdXRob3IgeWVpa29zXHJcbiAqIEByZXBvc2l0b3J5IGh0dHBzOi8vZ2l0aHViLmNvbS95ZWlrb3MvanMubWVyZ2VcclxuXHJcbiAqIENvcHlyaWdodCAyMDE0IHllaWtvcyAtIE1JVCBsaWNlbnNlXHJcbiAqIGh0dHBzOi8vcmF3LmdpdGh1Yi5jb20veWVpa29zL2pzLm1lcmdlL21hc3Rlci9MSUNFTlNFXHJcbiAqL1xyXG5cclxuOyhmdW5jdGlvbihpc05vZGUpIHtcclxuXHJcblx0LyoqXHJcblx0ICogTWVyZ2Ugb25lIG9yIG1vcmUgb2JqZWN0cyBcclxuXHQgKiBAcGFyYW0gYm9vbD8gY2xvbmVcclxuXHQgKiBAcGFyYW0gbWl4ZWQsLi4uIGFyZ3VtZW50c1xyXG5cdCAqIEByZXR1cm4gb2JqZWN0XHJcblx0ICovXHJcblxyXG5cdHZhciBQdWJsaWMgPSBmdW5jdGlvbihjbG9uZSkge1xyXG5cclxuXHRcdHJldHVybiBtZXJnZShjbG9uZSA9PT0gdHJ1ZSwgZmFsc2UsIGFyZ3VtZW50cyk7XHJcblxyXG5cdH0sIHB1YmxpY05hbWUgPSAnbWVyZ2UnO1xyXG5cclxuXHQvKipcclxuXHQgKiBNZXJnZSB0d28gb3IgbW9yZSBvYmplY3RzIHJlY3Vyc2l2ZWx5IFxyXG5cdCAqIEBwYXJhbSBib29sPyBjbG9uZVxyXG5cdCAqIEBwYXJhbSBtaXhlZCwuLi4gYXJndW1lbnRzXHJcblx0ICogQHJldHVybiBvYmplY3RcclxuXHQgKi9cclxuXHJcblx0UHVibGljLnJlY3Vyc2l2ZSA9IGZ1bmN0aW9uKGNsb25lKSB7XHJcblxyXG5cdFx0cmV0dXJuIG1lcmdlKGNsb25lID09PSB0cnVlLCB0cnVlLCBhcmd1bWVudHMpO1xyXG5cclxuXHR9O1xyXG5cclxuXHQvKipcclxuXHQgKiBDbG9uZSB0aGUgaW5wdXQgcmVtb3ZpbmcgYW55IHJlZmVyZW5jZVxyXG5cdCAqIEBwYXJhbSBtaXhlZCBpbnB1dFxyXG5cdCAqIEByZXR1cm4gbWl4ZWRcclxuXHQgKi9cclxuXHJcblx0UHVibGljLmNsb25lID0gZnVuY3Rpb24oaW5wdXQpIHtcclxuXHJcblx0XHR2YXIgb3V0cHV0ID0gaW5wdXQsXHJcblx0XHRcdHR5cGUgPSB0eXBlT2YoaW5wdXQpLFxyXG5cdFx0XHRpbmRleCwgc2l6ZTtcclxuXHJcblx0XHRpZiAodHlwZSA9PT0gJ2FycmF5Jykge1xyXG5cclxuXHRcdFx0b3V0cHV0ID0gW107XHJcblx0XHRcdHNpemUgPSBpbnB1dC5sZW5ndGg7XHJcblxyXG5cdFx0XHRmb3IgKGluZGV4PTA7aW5kZXg8c2l6ZTsrK2luZGV4KVxyXG5cclxuXHRcdFx0XHRvdXRwdXRbaW5kZXhdID0gUHVibGljLmNsb25lKGlucHV0W2luZGV4XSk7XHJcblxyXG5cdFx0fSBlbHNlIGlmICh0eXBlID09PSAnb2JqZWN0Jykge1xyXG5cclxuXHRcdFx0b3V0cHV0ID0ge307XHJcblxyXG5cdFx0XHRmb3IgKGluZGV4IGluIGlucHV0KVxyXG5cclxuXHRcdFx0XHRvdXRwdXRbaW5kZXhdID0gUHVibGljLmNsb25lKGlucHV0W2luZGV4XSk7XHJcblxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBvdXRwdXQ7XHJcblxyXG5cdH07XHJcblxyXG5cdC8qKlxyXG5cdCAqIE1lcmdlIHR3byBvYmplY3RzIHJlY3Vyc2l2ZWx5XHJcblx0ICogQHBhcmFtIG1peGVkIGlucHV0XHJcblx0ICogQHBhcmFtIG1peGVkIGV4dGVuZFxyXG5cdCAqIEByZXR1cm4gbWl4ZWRcclxuXHQgKi9cclxuXHJcblx0ZnVuY3Rpb24gbWVyZ2VfcmVjdXJzaXZlKGJhc2UsIGV4dGVuZCkge1xyXG5cclxuXHRcdGlmICh0eXBlT2YoYmFzZSkgIT09ICdvYmplY3QnKVxyXG5cclxuXHRcdFx0cmV0dXJuIGV4dGVuZDtcclxuXHJcblx0XHRmb3IgKHZhciBrZXkgaW4gZXh0ZW5kKSB7XHJcblxyXG5cdFx0XHRpZiAodHlwZU9mKGJhc2Vba2V5XSkgPT09ICdvYmplY3QnICYmIHR5cGVPZihleHRlbmRba2V5XSkgPT09ICdvYmplY3QnKSB7XHJcblxyXG5cdFx0XHRcdGJhc2Vba2V5XSA9IG1lcmdlX3JlY3Vyc2l2ZShiYXNlW2tleV0sIGV4dGVuZFtrZXldKTtcclxuXHJcblx0XHRcdH0gZWxzZSB7XHJcblxyXG5cdFx0XHRcdGJhc2Vba2V5XSA9IGV4dGVuZFtrZXldO1xyXG5cclxuXHRcdFx0fVxyXG5cclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gYmFzZTtcclxuXHJcblx0fVxyXG5cclxuXHQvKipcclxuXHQgKiBNZXJnZSB0d28gb3IgbW9yZSBvYmplY3RzXHJcblx0ICogQHBhcmFtIGJvb2wgY2xvbmVcclxuXHQgKiBAcGFyYW0gYm9vbCByZWN1cnNpdmVcclxuXHQgKiBAcGFyYW0gYXJyYXkgYXJndlxyXG5cdCAqIEByZXR1cm4gb2JqZWN0XHJcblx0ICovXHJcblxyXG5cdGZ1bmN0aW9uIG1lcmdlKGNsb25lLCByZWN1cnNpdmUsIGFyZ3YpIHtcclxuXHJcblx0XHR2YXIgcmVzdWx0ID0gYXJndlswXSxcclxuXHRcdFx0c2l6ZSA9IGFyZ3YubGVuZ3RoO1xyXG5cclxuXHRcdGlmIChjbG9uZSB8fCB0eXBlT2YocmVzdWx0KSAhPT0gJ29iamVjdCcpXHJcblxyXG5cdFx0XHRyZXN1bHQgPSB7fTtcclxuXHJcblx0XHRmb3IgKHZhciBpbmRleD0wO2luZGV4PHNpemU7KytpbmRleCkge1xyXG5cclxuXHRcdFx0dmFyIGl0ZW0gPSBhcmd2W2luZGV4XSxcclxuXHJcblx0XHRcdFx0dHlwZSA9IHR5cGVPZihpdGVtKTtcclxuXHJcblx0XHRcdGlmICh0eXBlICE9PSAnb2JqZWN0JykgY29udGludWU7XHJcblxyXG5cdFx0XHRmb3IgKHZhciBrZXkgaW4gaXRlbSkge1xyXG5cclxuXHRcdFx0XHR2YXIgc2l0ZW0gPSBjbG9uZSA/IFB1YmxpYy5jbG9uZShpdGVtW2tleV0pIDogaXRlbVtrZXldO1xyXG5cclxuXHRcdFx0XHRpZiAocmVjdXJzaXZlKSB7XHJcblxyXG5cdFx0XHRcdFx0cmVzdWx0W2tleV0gPSBtZXJnZV9yZWN1cnNpdmUocmVzdWx0W2tleV0sIHNpdGVtKTtcclxuXHJcblx0XHRcdFx0fSBlbHNlIHtcclxuXHJcblx0XHRcdFx0XHRyZXN1bHRba2V5XSA9IHNpdGVtO1xyXG5cclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHR9XHJcblxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiByZXN1bHQ7XHJcblxyXG5cdH1cclxuXHJcblx0LyoqXHJcblx0ICogR2V0IHR5cGUgb2YgdmFyaWFibGVcclxuXHQgKiBAcGFyYW0gbWl4ZWQgaW5wdXRcclxuXHQgKiBAcmV0dXJuIHN0cmluZ1xyXG5cdCAqXHJcblx0ICogQHNlZSBodHRwOi8vanNwZXJmLmNvbS90eXBlb2Z2YXJcclxuXHQgKi9cclxuXHJcblx0ZnVuY3Rpb24gdHlwZU9mKGlucHV0KSB7XHJcblxyXG5cdFx0cmV0dXJuICh7fSkudG9TdHJpbmcuY2FsbChpbnB1dCkuc2xpY2UoOCwgLTEpLnRvTG93ZXJDYXNlKCk7XHJcblxyXG5cdH1cclxuXHJcblx0aWYgKGlzTm9kZSkge1xyXG5cclxuXHRcdG1vZHVsZS5leHBvcnRzID0gUHVibGljO1xyXG5cclxuXHR9IGVsc2Uge1xyXG5cclxuXHRcdHdpbmRvd1twdWJsaWNOYW1lXSA9IFB1YmxpYztcclxuXHJcblx0fVxyXG5cclxufSkodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlICYmIHR5cGVvZiBtb2R1bGUuZXhwb3J0cyA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpOyIsIi8qKlxuICogTmltYmxlXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTEgQ2FvbGFuIE1jTWFob25cbiAqXG4gKiBOaW1ibGUgaXMgZnJlZWx5IGRpc3RyaWJ1dGFibGUgdW5kZXIgdGhlIE1JVCBsaWNlbnNlLlxuICpcbiAqIFRoaXMgc291cmNlIGNvZGUgaXMgb3B0aW1pemVkIGZvciBtaW5pZmljYXRpb24gYW5kIGd6aXAgY29tcHJlc3Npb24sIG5vdFxuICogcmVhZGFiaWxpdHkuIElmIHlvdSB3YW50IHJlYXNzdXJhbmNlLCBzZWUgdGhlIHRlc3Qgc3VpdGUuXG4gKi9cblxuKGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cbiAgICB2YXIga2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIChvYmopIHtcbiAgICAgICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICAgICAgZm9yICh2YXIgayBpbiBvYmopIHtcbiAgICAgICAgICAgIGlmIChvYmouaGFzT3duUHJvcGVydHkoaykpIHtcbiAgICAgICAgICAgICAgICByZXN1bHRzLnB1c2goayk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdHM7XG4gICAgfTtcblxuICAgIHZhciBmYWxsYmFjayA9IGZ1bmN0aW9uIChuYW1lLCBmYWxsYmFjaykge1xuICAgICAgICB2YXIgbmF0aXZlRm4gPSBBcnJheS5wcm90b3R5cGVbbmFtZV07XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgbWVtbykge1xuICAgICAgICAgICAgdmFyIGZuID0gb2JqID8gb2JqW25hbWVdOiAwO1xuICAgICAgICAgICAgcmV0dXJuIGZuICYmIGZuID09PSBuYXRpdmVGbiA/XG4gICAgICAgICAgICAgICAgZm4uY2FsbChvYmosIGl0ZXJhdG9yLCBtZW1vKTpcbiAgICAgICAgICAgICAgICBmYWxsYmFjayhvYmosIGl0ZXJhdG9yLCBtZW1vKTtcbiAgICAgICAgfTtcbiAgICB9O1xuXG4gICAgdmFyIGVhY2hTeW5jID0gZmFsbGJhY2soJ2ZvckVhY2gnLCBmdW5jdGlvbiAob2JqLCBpdGVyYXRvcikge1xuICAgICAgICB2YXIgaXNPYmogPSBvYmogaW5zdGFuY2VvZiBPYmplY3Q7XG4gICAgICAgIHZhciBhcnIgPSBpc09iaiA/IGtleXMob2JqKTogKG9iaiB8fCBbXSk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBhcnIubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgICAgICAgIHZhciBrID0gaXNPYmogPyBhcnJbaV06IGk7XG4gICAgICAgICAgICBpdGVyYXRvcihvYmpba10sIGssIG9iaik7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHZhciBlYWNoUGFyYWxsZWwgPSBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGxlbiA9IG9iai5sZW5ndGggfHwga2V5cyhvYmopLmxlbmd0aDtcbiAgICAgICAgaWYgKCFsZW4pIHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBjb21wbGV0ZWQgPSAwO1xuICAgICAgICBlYWNoU3luYyhvYmosIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBjYiA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24gKCkge307XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAoKytjb21wbGV0ZWQgPT09IGxlbikge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cyk7XG4gICAgICAgICAgICBpZiAoaXRlcmF0b3IubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXJncyA9IGFyZ3Muc2xpY2UoMCwgaXRlcmF0b3IubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICAgICAgYXJnc1tpdGVyYXRvci5sZW5ndGggLSAxXSA9IGNiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgYXJncy5wdXNoKGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGl0ZXJhdG9yLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgdmFyIGVhY2hTZXJpZXMgPSBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIGtleXNfbGlzdCA9IGtleXMob2JqKTtcbiAgICAgICAgaWYgKCFrZXlzX2xpc3QubGVuZ3RoKSB7XG4gICAgICAgICAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgY29tcGxldGVkID0gMDtcbiAgICAgICAgdmFyIGl0ZXJhdGUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgayA9IGtleXNfbGlzdFtjb21wbGV0ZWRdO1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBbb2JqW2tdLCBrLCBvYmpdLnNsaWNlKDAsIGl0ZXJhdG9yLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgYXJnc1tpdGVyYXRvci5sZW5ndGggLSAxXSA9IGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24gKCkge307XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBpZiAoKytjb21wbGV0ZWQgPT09IGtleXNfbGlzdC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpdGVyYXRlKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgaXRlcmF0b3IuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH07XG4gICAgICAgIGl0ZXJhdGUoKTtcbiAgICB9O1xuXG4gICAgdmFyIG1hcFN5bmMgPSBmYWxsYmFjaygnbWFwJywgZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IpIHtcbiAgICAgICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICAgICAgZWFjaFN5bmMob2JqLCBmdW5jdGlvbiAodiwgaywgb2JqKSB7XG4gICAgICAgICAgICByZXN1bHRzW3Jlc3VsdHMubGVuZ3RoXSA9IGl0ZXJhdG9yKHYsIGssIG9iaik7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9KTtcblxuICAgIHZhciBtYXBBc3luYyA9IGZ1bmN0aW9uIChlYWNoZm4pIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICAgICAgICAgIGVhY2hmbihvYmosIGZ1bmN0aW9uICh2YWx1ZSwgaSwgb2JqLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgICAgIHZhciBjYiA9IGZ1bmN0aW9uIChlcnIsIHYpIHtcbiAgICAgICAgICAgICAgICAgICAgcmVzdWx0c1tyZXN1bHRzLmxlbmd0aF0gPSB2O1xuICAgICAgICAgICAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgdmFyIGFyZ3MgPSBbdmFsdWUsIGksIG9ial07XG4gICAgICAgICAgICAgICAgaWYgKGl0ZXJhdG9yLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgICAgICBhcmdzID0gYXJncy5zbGljZSgwLCBpdGVyYXRvci5sZW5ndGggLSAxKTtcbiAgICAgICAgICAgICAgICAgICAgYXJnc1tpdGVyYXRvci5sZW5ndGggLSAxXSA9IGNiO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgYXJncy5wdXNoKGNiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaXRlcmF0b3IuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyLCByZXN1bHRzKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgIH07XG5cbiAgICB2YXIgZmlsdGVyU3luYyA9IGZhbGxiYWNrKCdmaWx0ZXInLCBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHJlc3VsdHMgPSBbXTtcbiAgICAgICAgZWFjaFN5bmMob2JqLCBmdW5jdGlvbiAodiwgaywgb2JqKSB7XG4gICAgICAgICAgICBpZiAoaXRlcmF0b3Iodiwgaywgb2JqKSkge1xuICAgICAgICAgICAgICAgIHJlc3VsdHNbcmVzdWx0cy5sZW5ndGhdID0gdjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH0pO1xuXG4gICAgdmFyIGZpbHRlclBhcmFsbGVsID0gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gW107XG4gICAgICAgIGVhY2hQYXJhbGxlbChvYmosIGZ1bmN0aW9uICh2YWx1ZSwgaywgb2JqLCBjYWxsYmFjaykge1xuICAgICAgICAgICAgdmFyIGNiID0gZnVuY3Rpb24gKGVyciwgYSkge1xuICAgICAgICAgICAgICAgIGlmIChhKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlc3VsdHNbcmVzdWx0cy5sZW5ndGhdID0gdmFsdWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBbdmFsdWUsIGssIG9ial07XG4gICAgICAgICAgICBpZiAoaXRlcmF0b3IubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgYXJncyA9IGFyZ3Muc2xpY2UoMCwgaXRlcmF0b3IubGVuZ3RoIC0gMSk7XG4gICAgICAgICAgICAgICAgYXJnc1tpdGVyYXRvci5sZW5ndGggLSAxXSA9IGNiO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgYXJncy5wdXNoKGNiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGl0ZXJhdG9yLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICB9LCBmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICBjYWxsYmFjayhlcnIsIHJlc3VsdHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgdmFyIHJlZHVjZVN5bmMgPSBmYWxsYmFjaygncmVkdWNlJywgZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIG1lbW8pIHtcbiAgICAgICAgZWFjaFN5bmMob2JqLCBmdW5jdGlvbiAodiwgaSwgb2JqKSB7XG4gICAgICAgICAgICBtZW1vID0gaXRlcmF0b3IobWVtbywgdiwgaSwgb2JqKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBtZW1vO1xuICAgIH0pO1xuXG4gICAgdmFyIHJlZHVjZVNlcmllcyA9IGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBtZW1vLCBjYWxsYmFjaykge1xuICAgICAgICBlYWNoU2VyaWVzKG9iaiwgZnVuY3Rpb24gKHZhbHVlLCBpLCBvYmosIGNhbGxiYWNrKSB7XG4gICAgICAgICAgICB2YXIgY2IgPSBmdW5jdGlvbiAoZXJyLCB2KSB7XG4gICAgICAgICAgICAgICAgbWVtbyA9IHY7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB2YXIgYXJncyA9IFttZW1vLCB2YWx1ZSwgaSwgb2JqXTtcbiAgICAgICAgICAgIGlmIChpdGVyYXRvci5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBhcmdzID0gYXJncy5zbGljZSgwLCBpdGVyYXRvci5sZW5ndGggLSAxKTtcbiAgICAgICAgICAgICAgICBhcmdzW2l0ZXJhdG9yLmxlbmd0aCAtIDFdID0gY2I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBhcmdzLnB1c2goY2IpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaXRlcmF0b3IuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIGNhbGxiYWNrKGVyciwgbWVtbyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBleHBvcnRzLmVhY2ggPSBmdW5jdGlvbiAob2JqLCBpdGVyYXRvciwgY2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIChjYWxsYmFjayA/IGVhY2hQYXJhbGxlbDogZWFjaFN5bmMpKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKTtcbiAgICB9O1xuICAgIGV4cG9ydHMubWFwID0gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiAoY2FsbGJhY2sgPyBtYXBBc3luYyhlYWNoUGFyYWxsZWwpOiBtYXBTeW5jKShvYmosIGl0ZXJhdG9yLCBjYWxsYmFjayk7XG4gICAgfTtcbiAgICBleHBvcnRzLmZpbHRlciA9IGZ1bmN0aW9uIChvYmosIGl0ZXJhdG9yLCBjYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gKGNhbGxiYWNrID8gZmlsdGVyUGFyYWxsZWw6IGZpbHRlclN5bmMpKG9iaiwgaXRlcmF0b3IsIGNhbGxiYWNrKTtcbiAgICB9O1xuICAgIGV4cG9ydHMucmVkdWNlID0gZnVuY3Rpb24gKG9iaiwgaXRlcmF0b3IsIG1lbW8sIGNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiAoY2FsbGJhY2sgPyByZWR1Y2VTZXJpZXM6IHJlZHVjZVN5bmMpKG9iaiwgaXRlcmF0b3IsIG1lbW8sIGNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgZXhwb3J0cy5wYXJhbGxlbCA9IGZ1bmN0aW9uIChmbnMsIGNhbGxiYWNrKSB7XG4gICAgICAgIHZhciByZXN1bHRzID0gbmV3IGZucy5jb25zdHJ1Y3RvcigpO1xuICAgICAgICBlYWNoUGFyYWxsZWwoZm5zLCBmdW5jdGlvbiAoZm4sIGssIGNiKSB7XG4gICAgICAgICAgICBmbihmdW5jdGlvbiAoZXJyKSB7XG4gICAgICAgICAgICAgICAgdmFyIHYgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICAgICAgICAgICAgICAgIHJlc3VsdHNba10gPSB2Lmxlbmd0aCA8PSAxID8gdlswXTogdjtcbiAgICAgICAgICAgICAgICBjYihlcnIpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sIGZ1bmN0aW9uIChlcnIpIHtcbiAgICAgICAgICAgIChjYWxsYmFjayB8fCBmdW5jdGlvbiAoKSB7fSkoZXJyLCByZXN1bHRzKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIGV4cG9ydHMuc2VyaWVzID0gZnVuY3Rpb24gKGZucywgY2FsbGJhY2spIHtcbiAgICAgICAgdmFyIHJlc3VsdHMgPSBuZXcgZm5zLmNvbnN0cnVjdG9yKCk7XG4gICAgICAgIGVhY2hTZXJpZXMoZm5zLCBmdW5jdGlvbiAoZm4sIGssIGNiKSB7XG4gICAgICAgICAgICBmbihmdW5jdGlvbiAoZXJyLCByZXN1bHQpIHtcbiAgICAgICAgICAgICAgICB2YXIgdiA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgICAgICAgICAgICAgcmVzdWx0c1trXSA9IHYubGVuZ3RoIDw9IDEgPyB2WzBdOiB2O1xuICAgICAgICAgICAgICAgIGNiKGVycik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSwgZnVuY3Rpb24gKGVycikge1xuICAgICAgICAgICAgKGNhbGxiYWNrIHx8IGZ1bmN0aW9uICgpIHt9KShlcnIsIHJlc3VsdHMpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/IHRoaXMuXyA9IHRoaXMuXyB8fCB7fTogZXhwb3J0cykpO1xuIl19

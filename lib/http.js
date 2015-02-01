(function (root) {
    'use strict';

    var nodeHttp = require('http'),
        merge = require('merge'),
        mime = require('./mime'),
        _ = require('nimble'),
        constants = require('./constants'),
        util = require('./util'),
        CouchError = require('./CouchError'),
        url = require('url');


    /**
     * Interface to either jquery or node http
     * @param {Auth} auth
     * @param opts
     * @param opts.host
     * @constructor
     */
    function HTTP(auth, opts) {
        var host = opts.host || 'http://localhost:5984';
        if (host.length) {
            if (host[host.length - 1] == '/') {
                host = host.substring(0, host.length - 1);
            }
        }
        this.host = host.replace('http://', '');
        this.auth = auth;
    }

    HTTP.prototype = {
        _parseResponse: function (responseString, contentType, cb) {
            var parsedResponse;
            if (contentType) {
                if (contentType == constants.MIME.JSON) {
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
            return parsedResponse;
        }, /**
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
        _nHttp: function (opts, cb) {
            cb = cb || function () {
            };
            var parsedURL;
            if (opts.url) {
                parsedURL = url.parse(opts.url);
                // Check that the url param wasnt just a path...
                if (!parsedURL.host) parsedURL = url.parse(this._constructURL({path: opts.url}));
            }
            else {
                parsedURL = url.parse(this._constructURL({path: opts.path || ''}))
            }

            var data = opts.data,
                requestType = 'contentType' in opts ? opts.contentType : constants.MIME.JSON,
                responseType = mime.ensureMimeType(opts.dataType),
                method = opts.type || 'GET';

            var httpOpts = {
                method: method,
                hostname: parsedURL.hostname,
                port: parsedURL.port,
                path: parsedURL.path,
                admin: opts.admin
            };


            if (requestType) {
                if (data) data = mime.coerceData(requestType, data);
                httpOpts.headers = {'content-type': requestType};
            }
            if (!opts.ignoreAuth) this._configureAuth(httpOpts);
            var req = nodeHttp.request(httpOpts, function (res) {
                // Override to prevent circular JSON errors.
                var responseString = '';


                res.on('data', function (chunk) {
                    responseString += chunk;
                });

                res.on('end', function () {
                    var statusCode = res.statusCode,
                        rawContentType = res.headers['content-type'] || '',
                        isSuccess = statusCode >= 200 && statusCode < 300,
                        contentType = (responseType || rawContentType.split(';')[0]).trim(),
                        parsedResponse = this._parseResponse(responseString, contentType, cb);
                    res.responseText = responseString;
                    if (isSuccess) {
                        cb(null, parsedResponse, res);
                    }
                    else {
                        var responseData = parsedResponse || {},
                            errOpts = {
                                response: res,
                                status: statusCode,
                                responseData: parsedResponse,
                                reason: parsedResponse.reason,
                                error: parsedResponse.error
                            };
                        cb(new CouchError(errOpts), parsedResponse);
                    }
                }.bind(this));
            }.bind(this));

            if (data)  req.write(data);

            req.end();
        },
        /**
         *
         * @param opts
         * @param opts.path
         * @param [opts.protocol]
         * @returns {string}
         * @private
         */
        _constructURL: function (opts) {
            var protocol = opts.protocol || 'http://',
                path = opts.path;
            return protocol + this.host + (path.length ? (path[0] == '/' ? '' : '/') : '') + path;
        },
        _logHttpRequest: function (opts) {
            console.info('[CouchDB: HTTP Request]:', opts);
        }, /**
         * Send a HTTP request using jquery
         * @param opts - The usual jquery opts +
         * @param opts.path - Path to append to host
         * @param opts.admin - True if endpoint requires admin access
         * @param opts.ignoreAuth
         * @param opts.contentType
         * @param [cb]
         * @private
         */
        _$http: function (opts, cb) {
            cb = cb || function () {
                // Do nothing.
            };
            opts = merge({
                type: 'GET',
                contentType: constants.MIME.JSON
            }, opts || {});
            var coercedData = mime.coerceData(opts.contentType, opts.data);
            if (coercedData && coercedData.isError) {
                cb(coercedData);
                return;
            }
            if (coercedData != undefined) opts.data = coercedData;
            if (!opts.ignoreAuth) this._configureAuth(opts);
            var path = opts.path || '';
            if (opts.path != null) delete opts.path;
            if (!opts.url) opts.url = this._constructURL({path: path});
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
        },
        /**
         * Send a HTTP request. Uses either jquery or nodes http depending on what's available in the environment
         * @param opts - jquery style http opts
         * @param cb
         * @private
         */
        _http: function (opts, cb) {
            if (nodeHttp) this._nHttp(opts, cb);
            else this._$http(opts, cb);
        },
        /**
         * Configure the ajax/nodeHttp options to match the configured authorisation method.
         * @param opts
         * @private
         */
        _configureAuth: function (opts) {
            var auth = opts.admin ? this.auth.adminAuth : this.auth.auth;
            if (auth) {
                var headers = opts.headers || {};
                opts.headers = headers;
                // Allow for authorization overrides.
                if (!headers.Authorization) {
                    if (auth.method == constants.AUTH_METHOD.BASIC) {
                        // Note: jQuery >=1.7 has username/password options. I do this simply for backwards
                        // compatibility.
                        headers.Authorization = 'Basic ' + util.btoa(auth.username + ':' + auth.password);
                    }
                }
            }
        },
        /**
         * Send a HTTP request or multiple http requests in parallel
         * @param {Object|Array} opts - The usual jquery opts, or an array of them.
         * @param {Object} [opts.path] - Path to append to host
         * @param {Function} [cb]
         */
        http: function (opts, cb) {
            if (Array.isArray(opts)) {
                _.parallel(opts.map(function (_opts) {
                    return function (done) {
                        this._http(_opts, done);
                    }.bind(this)
                }.bind(this)), cb);
            }
            else {
                this._http(opts, cb);
            }
        },
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
        xhrHttp: function (opts, cb) {
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
                this._nHttp(nodeHTTPOpts, cb);
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
        },
        /**
         * same as http except default to json
         * @param opts
         * @param cb
         */
        json: function (opts, cb) {
            function _json(opts) {
                opts.dataType = 'json';
            }

            if (Array.isArray(opts)) {
                opts.forEach(_json);
            }
            else {
                _json(opts);
            }
            this.http(opts, cb);
        }
    };

    module.exports = function (auth, opts) {
        return new HTTP(auth, opts);
    };

})(this);
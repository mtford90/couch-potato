(function (root) {
    'use strict';

    var constants = require('./constants'),
        util = require('./util');

    /**
     *
     * @param {Auth} auth
     * @param {HTTP} http
     * @constructor
     */
    function Users(auth, http) {
        this.http = http;
        this.auth = auth;
        this.login.basic = this._basicAuth.bind(this);
    }

    Users.prototype = {
        /**
         * CouchDB has a weird convention for user identifiers. This function simply transforms the username into
         * to match that convention.
         * @param username
         * @returns {string}
         * @private
         */
        _getFullyQualifedUsername: function (username) {
            return 'org.couchdb.user:' + username;
        },
        /**
         * @param opts
         * @param opts.username
         * @param opts.password
         * @param opts.auth - the auth method to use
         * @param cb
         */
        register: function (opts, cb) {
            cb = cb || function () {
            };
            var username = opts.username,
                password = opts.password;
            var fullyQualifiedUsername = this._getFullyQualifedUsername(username);
            return util.promise(cb, function (cb) {
                this.http({
                    path: '_users/' + fullyQualifiedUsername,
                    method: 'PUT',
                    body: {
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
                            if (opts.auth == constants.AUTH_METHOD.BASIC) {
                                this.auth.setAuth({
                                    method: constants.AUTH_METHOD.BASIC,
                                    username: username,
                                    password: password,
                                    user: user
                                });
                                user.password = password;
                            }
                            else {
                                cb(util.error({message: 'NYI: Auth method "' + opts.auth + '"'}));
                            }
                        }
                    }
                    else {
                        // TODO: Log an error.
                    }
                    cb(err, user);
                }.bind(this));
            }.bind(this));
        },

        get: function (username, cb) {
            var fullyQualifiedUsername = this._getFullyQualifedUsername(username);
            return util.promise(cb, function (cb) {
                this.http({
                    path: '_users/' + fullyQualifiedUsername
                }, cb);
            }.bind(this));
        },

        /**
         * @param {Object} opts
         * @param opts.method - See Potato.AUTH_METHOD for possible
         * @param cb
         */
        login: function (opts, cb) {
            return util.promise(cb, function (cb) {
                if (opts.method == constants.AUTH_METHOD.BASIC) {
                    this._basicAuth(opts, cb);
                }
                else {
                    cb(util.error({message: 'No such auth method ' + opts.method}));
                }
            }.bind(this));
        },

        /**
         * Log a user out, clearing session if necessary.
         * @param [opts]
         * @param [opts.clearSession]
         * @param [cb]
         */
        logout: function (opts, cb) {
            if (typeof opts == 'function') {
                cb = opts;
                opts = {};
            }
            opts = opts || {};
            cb = cb || function () {
            };
            return util.promise(cb, function (cb) {
                var clearSession = opts.clearSession !== undefined ? opts.clearSession : true;
                if (clearSession) {
                    // It doesn't matter whether we're set to be using basic or session. If CouchDB has session auth enabled
                    // it will set a HTTP-only session cookie which it will prefer over basic authentication anyway...
                    // therefore we attempt to clear the session on logout.
                    this.http({
                        path: '_session',
                        method: 'DELETE'
                    }, function (err) {
                        if (!err) {
                            this.auth.logout();
                            cb();
                        }
                        else cb(err);
                    }.bind(this));
                }
                else cb();
            }.bind(this));
        },

        /**
         * Verify that username/password combination is correct by hitting the _session endpoint.
         * If this is the case, configure future authorisation method accordingly.
         * @param authOpts
         * @param authOpts.username
         * @param authOpts.password
         * @param cb
         */
        _basicAuth: function (authOpts, cb) {
            var username = authOpts.username,
                password = authOpts.password;
            var httpOpts = {
                path: '_session',
                method: 'POST',
                body: {
                    name: username,
                    password: password
                }
            };
            return util.promise(cb, function (cb) {
                this.http(httpOpts, function (err, data) {
                    if (!err) {
                        if (data.ok) {
                            this.auth.setAuth({
                                method: constants.AUTH_METHOD.BASIC,
                                username: username,
                                password: password,
                                user: data
                            });
                            data.username = username;
                            data.password = password;
                            data.name = username;
                            cb(null, data);
                        }
                        else {
                            this.auth.setAuth(null);
                            cb(util.error(data));
                        }
                    }
                    else {
                        cb(err);
                    }
                }.bind(this));
            }.bind(this));
        },
        verifyAuth: function (cb) {
            return util.promise(cb, function (cb) {
                var auth = this.auth.auth;
                if (auth) {
                    if (auth.method == constants.AUTH_METHOD.BASIC) {
                        this._basicAuth(auth, cb);
                    }
                }
                else {
                    cb(util.error({message: 'No auth method has been set.'}))
                }
            }.bind(this));
        }
    };


    module.exports = function (auth, http) {
        return new Users(auth, http);
    };
})
(this);
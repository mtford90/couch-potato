(function (root) {
    'use strict';

    var CouchError = require('./CouchError'),
        constants = require('./constants'),
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
            this.http.json({
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
                            cb(new CouchError({message: 'NYI: Auth method "' + opts.auth + '"'}));
                        }
                    }
                }
                else util.logError('Error creating user', err);
                cb(err, user);
            }.bind(this));
        },

        get: function (username, cb) {
            var fullyQualifiedUsername = this._getFullyQualifedUsername(username);
            this.http.json({
                path: '_users/' + fullyQualifiedUsername
            }, cb);
        },

        /**
         * @param {Object} opts
         * @param opts.method - See Potato.AUTH_METHOD for possible
         * @param cb
         */
        login: function (opts, cb) {
            if (opts.method == constants.AUTH_METHOD.BASIC) {
                this._basicAuth(opts,cb);
            }
            else {
                cb(new CouchError({message: 'No such auth method ' + opts.method}));
            }
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
                type: 'POST',
                contentType: "application/x-www-form-urlencoded",
                data: 'name=' + username + '&password=' + password
            };
            this.http.json(httpOpts, function (err, data) {
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
                        cb(new CouchError(data));
                    }
                }
                else {
                    cb(err);
                }
            }.bind(this));
        },
        verifyAuth: function (cb) {
            cb = cb || function () {
            };
            var auth = this.auth.auth;
            if (auth) {
                if (auth.method == constants.AUTH_METHOD.BASIC) {
                    this._basicAuth(auth, cb);
                }
            }
            else {
                cb(new CouchError({message: 'No auth method has been set.'}))
            }
        }
    };


    module.exports = function (auth, http) {
        return new Users(auth, http);
    };
})
(this);
(function () {
    'use strict';

    var constants = require('./constants'),
        util = require('./util');

    /**
     * Store authorisation information.
     * @param api
     * @param opts
     * @param opts.auth
     * @param opts.adminAuth
     * @constructor
     */
    function Auth(api, opts) {
        var auth = opts.auth;
        this.adminAuth = opts.adminAuth || {
            method: constants.AUTH_METHOD.BASIC,
            username: constants.DEFAULT_ADMIN,
            password: constants.DEFAULT_ADMIN
        };
        this.auth = auth;
        this.api = api;
        this._verify();
    }

    Auth.prototype = {
        setAuth: function (auth) {
            this.auth = auth;
            this.api.emit('auth', auth);
        },
        /**
         * Verify auth has been configured correctly. Throw an error if not.
         */
        _verify: function () {
            var auth = this.auth;
            if (auth) {
                if (auth.method) {
                    if (auth.method == constants.AUTH_METHOD.BASIC) {
                        if (!auth.username) {
                            throw util.error({message: 'Must specify username if using basic auth'});
                        }
                        if (!auth.password) {
                            throw util.error({message: 'Must specify password if using basic auth'});
                        }
                    }
                    else {
                        throw util.error({message: 'Unknown auth methid "' + auth.method + '"'});
                    }
                }
                else {
                    throw util.error({message: 'Must specify method in auth'});
                }
            }
        },
        logout: function () {
            this.setAuth(null);
        },
        /**
         * Configure the ajax options to match the configured authorisation method.
         * @param ajaxOpts
         */
        configure: function (ajaxOpts) {
            var authDetails = ajaxOpts.admin ? this.adminAuth : this.auth;
            console.log('configuring with auth details...', authDetails);
            if (authDetails) {
                var headers = ajaxOpts.headers || {};
                ajaxOpts.headers = headers;
                // Allow for authorization overrides.
                if (!headers.Authorization) {
                    if (authDetails.method == constants.AUTH_METHOD.BASIC) {
                        var username = authDetails.username,
                            password = authDetails.password;
                        headers.Authorization = 'Basic ' + util.btoa(username + ':' + password);
                    }
                }
            }

        }
    };

    module.exports = function (api, opts) {
        return new Auth(api, opts);
    };
})();
(function () {
    'use strict';

    var merge = require('merge');

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


    module.exports = CouchError;
})();
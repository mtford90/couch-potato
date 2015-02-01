(function () {
    'use strict';

    var Set = require('./Set');
    module.exports = {
        AUTH_METHOD: {
            BASIC: 'basic'
        },
        MIME: {
            JSON: 'application/json',
            PLAIN_TEXT: 'text/plain'
        },
        DEFAULT_ADMIN: 'admin',
        IGNORE_DATABASES: new Set(['_replicator', '_users']),
        HTTP_STATUS: {
            UNAUTHORISED: 401,
            CONFLICT: 409,
            NOT_FOUND: 404,
            FORBIDDEN: 403
        }
    }
})();
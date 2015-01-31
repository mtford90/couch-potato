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
        IGNORE_DATABASES: new Set(['_replicator'])
    }
})();
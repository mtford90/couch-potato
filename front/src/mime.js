(function () {
    'use strict';

    var constants = require('./constants'),
        CouchError = require('./CouchError'),
        util = require('./util');

    module.exports = {
        /**
         * Best efforts at ensuring that a string represents a MIME type.
         * @param {String} [dataType]
         */
        ensureMimeType: function (dataType) {
            if (dataType) {
                if (dataType.trim() == 'json') {
                    dataType = constants.MIME.JSON;
                }
            }
            return dataType;
        },
        /**
         * transform data into a string depending on the mimetype
         * @param mimeType
         * @param data
         * @returns {*}
         */
        coerceData: function (mimeType, data) {
            var coercedData;
            if (mimeType == constants.MIME.JSON) {
                if (data) {
                    if (!util.isString(data)) {
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
    };
})();
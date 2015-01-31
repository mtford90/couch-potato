(function (root) {
    'use strict';

    module.exports = {
        btoa: root.btoa || function (str) {
            return new Buffer(str).toString('base64');
        }
    };

})(this);
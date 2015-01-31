(function () {
    'use strict';

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
    module.exports = Set;
})();
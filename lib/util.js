(function (root) {
    'use strict';

    var PouchDB = require('PouchDB'),
        argsarray = require('argsarray'),
        Promise = require('lie');

    module.exports = {
        btoa: root.btoa || function (str) {
            return new Buffer(str).toString('base64');
        },
        isString: function (str) {
            return typeof str == 'string' || str instanceof String;
        },
        isObject: function (o) {
            return typeof o == 'object';
        },
        optsOrCb: function (fn) {
            return argsarray(function (args) {
                var argsObj = {};
                if (args[0] instanceof Function) {
                    argsObj.opts = {};
                    argsObj.cb = args[0];
                }
                else {
                    argsObj.opts = args[0] || {};
                    argsObj.cb = args[1] || function () {

                    };
                }
                return fn.call(this, argsObj);
            });
        },
        _logError: function (prelude, message) {
            console.error(prelude + ': ' + message);
        },
        /**
         * TODO: This is bloody ugly.
         * Pretty damn useful to be able to access the bound object on a function tho.
         * See: http://stackoverflow.com/questions/14307264/what-object-javascript-function-is-bound-to-what-is-its-this
         */
        _patchBind: function () {
            var _bind = Function.prototype.apply.bind(Function.prototype.bind);
            Object.defineProperty(Function.prototype, 'bind', {
                value: function (obj) {
                    var boundFunction = _bind(this, arguments);
                    Object.defineProperty(boundFunction, '__couch_potato_bound_object', {
                        value: obj,
                        writable: true,
                        configurable: true,
                        enumerable: false
                    });
                    return boundFunction;
                }
            });
        },
        /**
         * Log errors to console, depending on the kind of error.
         * @param prelude
         * @param err
         */
        logError: function (prelude, err) {
            if (err) {
                if (err.isCouchError) { // Will have an error code and a human-readable description
                    this._logError(prelude, '(' + err.error + ') ' + err.reason);
                }
                else if (err.isHttpError) { // Dump the status code and the response data.
                    this._logError(prelude, err.status + ': ' + JSON.stringify(err.responseData));
                }
                else if (err.message) { // Custom error with a message
                    this._logError(prelude, err.message);
                }
                else { // This should never happen...
                    console.error("Experienced a CouchError with no discernible meaning... " +
                    "This is a bug in Couch Potato's error handling. Please file a report");
                    this._logError(prelude, 'Unknown');
                }
            }
        },
        Promise: Promise,
        promise: function (cb, fn) {
            cb = cb || function () {
            };
            return new Promise(function (resolve, reject) {
                var _cb = argsarray(function (args) {
                    console.log('args', args);
                    var err = args[0],
                        rest = args.slice(1);
                    if (err) reject(err);
                    else resolve(rest[0]);
                    var bound = cb['__couch_potato_bound_object'] || cb; // Preserve bound object.
                    cb.apply(bound, args);
                });
                fn(_cb);
            })
        }
    };

})(this);
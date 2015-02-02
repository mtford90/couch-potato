/**
 * Testing facilities for CouchDB views
 */

(function () {
    var EventEmitter = require('events').EventEmitter,
        merge = require('merge'),
        util = require('./lib/util');

    'use strict';

    /**
     * Wraps a map function such that the emit function is available. Also attaches an eventemitter to make testing
     * easier.
     * @param {Function} mapFunc
     */
    function map(mapFunc) {
        var emitter = new EventEmitter();
        //noinspection JSUnusedLocalSymbols
        var wrappedMapFunc = function (doc) {
            var emit = function (key, value) {
                emitter.emit('emit', {id: doc._id, key: key, value: value});
            };
            // The reevaluation of mapFunc ensures that 'emit' is now within its environment.
            // Eval is evil yada-yada-yada but this is just for testing.
            var strFunc = mapFunc.toString();
            try {
                eval('var mapFunc = ' + strFunc);
            }
            catch (e) {
                if (e instanceof SyntaxError) {
                    throw new Error('Error parsing map function. Is it actually a function?');
                }
                else throw e;
            }
            mapFunc(doc);
        };
        wrappedMapFunc.on = emitter.on.bind(emitter);
        wrappedMapFunc.once = emitter.once.bind(emitter);
        wrappedMapFunc.removeListener = emitter.removeListener.bind(emitter);
        wrappedMapFunc.removeAllListeners = emitter.removeAllListeners.bind(emitter);
        return wrappedMapFunc;
    }

    /**
     * A mock of CouchDB's map/reduce functionality. Allows testing of map/reduce queries using Mocha etc.
     * @param {Function} mapFunc
     * @param {Function} [reduceFunc]
     */
    function mapReduce(mapFunc, reduceFunc) {
        mapFunc = map(mapFunc);
        var emitter = new EventEmitter();
        var rows = [],
            rereduce = [],
            keys = {};
        return merge(emitter, {
            /**
             * Map data into your map/reduce view
             * @param data - An array of objects & arrays, where arrays are treated as reductions and hence passed with rereduce=true
             * @param opts
             * @param opts.group
             */
            map: function (data, opts) {
                mapFunc.on('emit', function (row) {
                    if (!keys[row.key]) keys[row.key] = [];
                    keys[row.key].push(row);
                    rows.push(row);
                });
                data.forEach(function (datum) {
                    if (Array.isArray(datum)) rereduce.push(datum);
                    else mapFunc(datum);
                });
                var res;
                if (reduceFunc) {
                    var reducedRows = [];
                    Object.keys(keys).forEach(function (key) {
                        var rows = keys[key];
                        var pairs = [],
                            value = [];
                        rows.forEach(function (row) {
                            pairs.push([row.key, row.id]);
                            value.push(row.value);
                        });
                    });

                    res = {
                        rows: reducedRows
                    };
                }
                else {
                    res = {
                        total_rows: data.length,
                        rows: rows,
                        offset: 0
                    };
                }
                return res;
            }
        });
    }

    module.exports = {
        map: map,
        mapReduce: mapReduce
    };
})();
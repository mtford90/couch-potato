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
    function wrapMap(mapFunc) {
        var emitter = new EventEmitter();
        //noinspection JSUnusedLocalSymbols
        var emit = emitter.emit.bind(emitter, 'emit');

        // The reevaluation of mapFunc ensures that 'emit' is now within its environment.
        eval('mapFunc = ' + mapFunc.toString());
        console.log(mapFunc);
        mapFunc.on = emitter.on.bind(emitter);
        mapFunc.once = emitter.once.bind(emitter);
        mapFunc.removeListener = emitter.removeListener.bind(emitter);
        mapFunc.removeAllListeners = emitter.removeAllListeners.bind(emitter);
        return mapFunc;
    }

    /**
     * A mock of CouchDB's map/reduce functionality. Allows testing of map/reduce queries using Mocha etc.
     * @param {Function} mapFunc
     * @param {Function} [reduceFunc]
     */
    function wrapMapReduce(mapFunc, reduceFunc) {
        mapFunc = wrapMap(mapFunc);
        var emitter = new EventEmitter();
        var toReduce = {},
            toRereduce = [];
        return merge(emitter, {
            /**
             * Map data into your map/reduce view
             * @param data - An array of objects & arrays, where arrays are treated as reductions and hence passed with rereduce=true
             */
            map: function (data) {
                mapFunc.on('emit', function (key, value) {
                    if (!toReduce[key]) toReduce[key] = [];
                    toReduce[key].push(value);
                });
                data.forEach(function (datum) {
                    if (util.isArray(datum)) {
                        toRereduce.push(datum);
                    }
                    else {
                        mapFunc(datum);
                    }
                });
                var values;
                if (reduceFunc) {
                    values = Object.keys(toReduce).reduce(function (values, key) {
                        return values.concat(reduceFunc(key, toReduce[key], false));
                    }, []);
                    toRereduce.forEach(function (values) {
                        values = values.concat(reduceFunc(null, values, true));
                    });
                }
                else {
                    values = toReduce;
                }
                return values;
            }
        });
    }

    module.exports = {
        wrapMap: wrapMap,
        wrapReduce: wrapReduce,
        wrapMapReduce: wrapMapReduce
    };
})();
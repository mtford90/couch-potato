/**
 * Testing facilities for CouchDB views
 */

(function () {
    var EventEmitter = require('events').EventEmitter,
        merge = require('merge'),
        PouchDB = require('pouchdb'),
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

    var guid = (function () {
        function s4() {
            return Math.floor((1 + Math.random()) * 0x10000)
                .toString(16)
                .substring(1);
        }

        return function () {
            return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
                s4() + '-' + s4() + s4() + s4();
        };
    })();


    module.exports = {
        map: map,
        mapReduce: function (mapFunc, reduceFunc, cb) {
            var db = new PouchDB(guid(), {db: require('memdown')});
            var view = {
                map: mapFunc.toString()
            };
            if (reduceFunc) view.reduce = reduceFunc.toString();
            var myDesignDoc = {
                _id: '_design/view',
                views: {
                    view: view
                }
            };
            return db.put(myDesignDoc, function (err) {
                if (!err) {
                    cb(null, db.query.bind(db, 'view'));
                } else cb(err);
            });
        }
    };
})();
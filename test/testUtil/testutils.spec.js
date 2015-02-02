/* globals emit */

var assert = require('chai').assert,
    testUtil = require('../../testUtil');

describe.only('Test utils', function () {
    it('wrapMap', function (done) {
        var _doc = {x: 1, _id: 'abc'};
        var map = testUtil.map(function (doc) {
            if (doc.x == 1) {
                emit(doc._id, doc);
            }
        });
        map.once('emit', function (row) {
            assert.equal(row.id, 'abc');
            assert.equal(row.value, _doc);
            assert.equal(row.key, 'abc');
            done();
        });
        map(_doc);
    });

    describe('map/reduce', function () {
        it('map only should return a key/value object', function () {
            var mapReducer = testUtil.mapReduce(
                function (doc) {
                    emit(doc._id, doc);
                }
            );
            var results = mapReducer.map([{_id: 1}, {_id: 2}]);
            assert.equal(results[1].length, 1);
            assert.equal(results[2].length, 1);
            assert.equal(results[1][0]._id, 1);
            assert.equal(results[2][0]._id, 2);
        });
        it('map/reduce', function () {
            var mapReducer = testUtil.mapReduce(
                function (doc) {
                    emit(doc.age, doc);
                },
                function (key, values) {
                    return values.length;
                }
            );
            var docs = [{_id: 1}, {_id: 2}];
            var results = mapReducer.map(docs, {
                group: false
            });
        });
    });

});
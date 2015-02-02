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
        it('map/reduce', function (done) {
            var mapReducer = testUtil.mapReduce(
                function (doc) {
                    emit(doc.age, doc);
                },
                function (key, values) {
                    return values.length;
                },
                function (err, query) {
                    query(function (err, resp) {
                        assert.notOk(err);
                        console.log('resp', resp);
                        assert.ok(resp);
                        done();
                    })

                }
            );
        });
    });

});
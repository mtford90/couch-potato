/* globals emit */

var assert = require('chai').assert,
    testUtil = require('../../testUtil');

describe.only('Test utils', function () {
    it('wrapMap', function (done) {
        var _doc = {x: 1, _id: 'abc'};
        var map = testUtil.wrapMap(function (doc) {
            if (doc.x == 1) {
                emit(doc._id, doc);
            }
        });
        map.once('emit', function (ident, doc) {
            assert.equal(ident, 'abc');
            assert.equal(doc, _doc);
            done();
        });
        map(_doc);
    });
    it('wrapReduce', function () {
       
    })
}); 
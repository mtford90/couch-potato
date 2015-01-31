var assert = require('chai').assert,
    couchdb = require('../api').couchdb;

describe('CouchDB', function () {
    var couch = couchdb();
    it('info', function (done) {
        couch.info(function (err, data) {
            assert.notOk(err);
            done();
        });
    });
});
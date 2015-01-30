var assert = require('chai').assert,
    couchdb = require('../src/couchdb').couchdb;

describe('CouchDB', function () {
    var couch = couchdb();
    it('info', function (done) {
        couch.info(function (err, data) {
            assert.notOk(err);
            done();
        });
    });
});
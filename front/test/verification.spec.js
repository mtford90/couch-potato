var assert = require('chai').assert;

describe('verificaiton', function () {
    var couch = couchdb();
    beforeEach(function (done) {
        couch.admin.reset(done);
    });
    it('should fail if no db', function (done) {
        couchdb().verify(function (err) {
            assert.ok(err);
            done();
        });
    });
    it('should succeed if db exists', function (done) {
        couch.admin.createDatabase(function (err) {
            assert.notOk(err);
            couchdb().verify(done);
        });
    });
});
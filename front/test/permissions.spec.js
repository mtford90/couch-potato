var assert = require('chai').assert;

describe('permissions', function () {
    var couch = couchdb();
    beforeEach(function (done) {
        couch.admin.reset(function (err) {
            if (!err) {
                couch.admin.createDatabase(done);
            }
            else done(err);
        });
    });
    it('get default permissions', function (done) {
        couch.admin.getPermissions(function (err, resp) {
            assert.notOk(err);
            console.log('resp', resp);
            done();
        });
    });
}); 
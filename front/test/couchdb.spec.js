var assert = require('chai').assert;

describe('CouchDB', function () {
    var couch = couchdb();
    it('info', function (done) {
        couch.info(function (err, data) {
            console.log('data', data);
            done(err);
        });
    });
});
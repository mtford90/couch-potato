var assert = require('chai').assert,
    prettyJson = require('./util').prettyJson;


describe('attachments', function () {
    var couch = couchdb();
    beforeEach(function (done) {
        couch.admin.reset(function (err) {
            if (!err) {
                couch.admin.createDatabase({anonymousUpdates: true, anonymousReads: true}, done);
            }
            else done(err);
        });
    });
    it('put attachment', function (done) {
        couch.upsertDocument({x: 1}, function (err, doc) {
            assert.notOk(err);
            couch.putAttachment({
                doc: doc,
                data: 'xyz',
                attName: 'myAttr',
                mimeType: 'text/plain'
            }, function (err) {
                done(err);
            });
        })
    });
    it('get attachment', function (done) {
        couch.upsertDocument({x: 1}, function (err, doc) {
            assert.notOk(err);
            couch.putAttachment({
                doc: doc,
                data: 'xyz',
                attName: 'myAttr',
                mimeType: 'text/plain'
            }, function (err) {
                assert.notOk(err);
                couch.getAttachment({
                    doc: doc,
                    attName: 'myAttr'
                }, function (err) {
                    done(err);
                });
            });
        })
    });
});
var assert = require('chai').assert;

describe('upsert documents', function () {
    var couch = couchdb();
    beforeEach(function (done) {
        couch.admin.reset(function (err) {
            if (!err) {
                couch.admin.createDatabase(done);
            }
            else done(err);
        });
    });
    describe('no user', function () {
        it('auto ids', function (done) {
            couch.upsertDocument({x: 1}, function (err, doc, resp) {
                assert.notOk(err);
                assert.ok(resp.id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                assert.equal(doc.x, 1);
                assert.equal(doc._id, resp.id);
                assert.equal(doc._rev, resp.rev);
                done();
            });
        });
        it('custom ids', function (done) {
            var _id = 'abc';
            couch.upsertDocument({x: 1, _id: 'abc'}, function (err, doc, resp) {
                assert.notOk(err);
                assert.equal(resp.id, _id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                assert.equal(doc.x, 1);
                assert.equal(doc._id, resp.id);
                assert.equal(doc._rev, resp.rev);
                done();
            });
        });
    });
    describe('user', function () {
        beforeEach(function (done) {
            couch.createUser({username: 'mike', password: 'mike'}, function (err) {
                if (!err) {
                    couch.basicAuth({
                        username: 'mike', password: 'mike'
                    }, done);
                } else done(err);
            });
        });
        it('auto ids', function (done) {
            couch.upsertDocument({x: 1}, function (err, doc, resp) {
                assert.notOk(err);
                assert.ok(resp.id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                assert.equal(doc.x, 1);
                assert.equal(doc._id, resp.id);
                assert.equal(doc._rev, resp.rev);
                assert.equal(doc.user, couch.auth.user.name);
                done();
            });
        });
        it('custom ids', function (done) {
            var _id = 'abc';
            couch.upsertDocument({x: 1, _id: 'abc'}, function (err, doc, resp) {
                assert.notOk(err);
                assert.equal(resp.id, _id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                assert.equal(doc.x, 1);
                assert.equal(doc._id, resp.id);
                assert.equal(doc._rev, resp.rev);
                assert.equal(doc.user, couch.auth.user.name);
                done();
            });
        });
        it('user in doc, null, should return an error', function (done) {
            couch.upsertDocument({user: null}, function (err) {
                assert.ok(err.isUserError);
                done();
            });
        });
        it('user in doc, undefined, should return an error', function (done) {
            couch.upsertDocument({user: undefined}, function (err) {
                assert.ok(err.isUserError);
                done();
            });
        });
        it('user in doc, empty str, should return an error', function (done) {
            couch.upsertDocument({user: ''}, function (err) {
                assert.ok(err.isUserError);
                done();
            });
        });
        it('user in doc, val, should return an error', function (done) {
            couch.upsertDocument({user: 12314}, function (err) {
                assert.ok(err.isUserError);
                done();
            });
        });
    });
});
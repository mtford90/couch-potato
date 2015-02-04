var assert = require('chai').assert,
    Potato = require('../potato'),
    potato = new Potato(),
    prettyJson = require('./util').prettyJson;


describe('upsert documents', function () {
    var db;
    beforeEach(function (done) {
        potato.reset(function (err) {
            assert.notOk(err, 'Error when reset database: ' + prettyJson(err));
            potato.getOrCreateDatabase('db', {anonymousUpdates: true, anonymousReads: true}, function (err, _db) {
                assert.notOk(err);
                db = _db;
                done();
            });
        });
    });

    describe('no user', function () {

        it('auto ids', function (done) {
            db.post({x: 1}, function (err, resp) {
                assert.notOk(err, 'Was expecting error to be falsy: ' + prettyJson(err));
                assert.ok(resp.id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                done();
            });
        });
        it('custom ids', function (done) {
            var _id = 'abc';
            db.put({x: 1, _id: 'abc'}, {include_doc: true}, function (err, resp) {
                assert.notOk(err);
                assert.equal(resp.id, _id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                done();
            });
        });
    });
    describe('user', function () {
        beforeEach(function (done) {
            potato.accounts.register({username: 'mike', password: 'mike'}, function (err) {
                assert.notOk(err);
                potato.accounts.login({
                    username: 'mike',
                    password: 'mike',
                    method: Potato.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.notOk(err);
                    done();
                });
            });
        });
        it('auto ids', function (done) {
            db.post({x: 1}, function (err, resp) {
                assert.notOk(err);
                assert.ok(resp.id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                done();
            });
        });
        it('custom ids', function (done) {
            var _id = 'abc';
            db.put({x: 1, _id: 'abc'}, function (err, resp) {
                assert.notOk(err);
                assert.equal(resp.id, _id);
                assert.ok(resp.rev);
                assert.ok(resp.ok);
                done();
            });
        });
        it('user in doc, null, should return an error', function (done) {
            db.post({user: null}, function (err) {
                assert.ok(err);
                done();
            });
        });
        it('user in doc, undefined, should return an error', function (done) {
            db.post({user: undefined}, function (err) {
                assert.ok(err);
                done();
            });
        });
        it('user in doc, empty str, should return an error', function (done) {
            db.post({user: ''}, function (err) {
                assert.ok(err);
                done();
            });
        });
        it('user in doc, val, should return an error', function (done) {
            db.post({user: 12314}, function (err) {
                assert.ok(err);
                done();
            });
        });
    });
});
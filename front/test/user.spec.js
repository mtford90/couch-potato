var assert = require('chai').assert,
    couchdb = require('../src/couchdb').couchdb;

describe('User management', function () {
    var couch = couchdb();
    describe('get user', function () {
        beforeEach(function (done) {
            couch.admin.reset(done);
        });
        it('random user, should only be able to get the name', function (done) {
            var username = 'mike',
                password = 'mike';
            couch.createUser({
                username: username,
                password: password
            }, function (err) {
                if (!err) {
                    couch.getUser('mike', function (err, doc) {
                        assert.ok(doc._id);
                        assert.ok(doc._rev);
                        assert.equal(doc.name, username);
                        done();
                    });
                } else done(err);
            });
        });

        it('no user exists', function (done) {
            couch.getUser('mike', function (err, doc) {
                assert.notOk(doc);
                assert.ok(err.isHttpError);
                done();
            });
        });
    });
    describe('auth', function () {
        beforeEach(function (done) {
            couch.admin.reset(done);
        });
        describe('basic', function () {
            it('fail', function (done) {
                couch.basicAuth({
                    username: 'bob',
                    password: 'yo'
                }, function (err) {
                    assert.ok(err, 'Should be an error');
                    assert.ok(err.isHttpError);
                    assert.equal(err.status, couch.HTTP_STATUS.UNAUTHORISED);
                    assert.notOk(couch.auth);
                    done();
                })
            });
            it('success', function (done) {
                var username = 'mike',
                    password = 'mike';
                couch.createUser({
                    username: username,
                    password: password
                }, function (err) {
                    assert.notOk(err);
                    assert.notOk(couch.auth);
                    couch.basicAuth({
                        username: username,
                        password: password
                    }, function (err) {
                        assert.notOk(err);
                        assert.equal(couch.auth.method, couch.AUTH_METHOD.BASIC);
                        assert.equal(couch.auth.username, username);
                        assert.equal(couch.auth.password, password);
                        assert.equal(couch.auth.user.name, username);
                        done();
                    });
                });
            });
            it('logout', function () {
                couch.auth = {};
                assert.ok(couch.auth);
                couch.logout();
                assert.notOk(couch.auth);
            });
        });

    });
});
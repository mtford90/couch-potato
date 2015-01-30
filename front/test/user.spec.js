var assert = require('chai').assert,
    couchdb = require('../src/couchdb').couchdb;

describe('User management', function () {
    var couch = couchdb();

    describe('create user', function () {
        beforeEach(function (done) {
            couch.admin.reset(done);
        });
        it('returns a user document', function (done) {
            var username = 'mike',
                password = 'mike';
            couch.createUser({
                username: username,
                password: password
            }, function (err, user) {
                assert.notOk(err);
                assert.ok(user);
                assert.equal(user.name, 'mike');
                assert.ok(user._id);
                assert.ok(user._rev);
                done();
            });
        });

        describe('if auth method is specified, logs the user in', function () {
            it('basic', function (done) {
                var username = 'mike',
                    password = 'mike';
                couch.createUser({
                    username: username,
                    password: password,
                    auth: couch.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.notOk(err);
                    var auth = couch.auth;
                    assert.ok(auth, 'auth should be set on successfuly user creation!');
                    assert.equal(auth.method, couch.AUTH_METHOD.BASIC);
                    var user = auth.user;
                    assert.ok(user);
                    assert.equal(user.name, 'mike');
                    assert.equal(user.username, 'mike');
                    assert.equal(user.password, 'mike');
                    assert.ok(user._id);
                    assert.ok(user._rev);
                    assert.equal(auth.username, 'mike');
                    assert.equal(auth.password, 'mike');
                    done();
                });
            });
        });
    });

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
                assert.notOk(err);
                couch.logout();
                couch.getUser('mike', function (err, doc) {
                    assert.ok(doc._id);
                    assert.ok(doc._rev);
                    assert.equal(doc.name, username);
                    done();
                });
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
                    }, function (err, user) {
                        assert.notOk(err);
                        assert.equal(couch.auth.method, couch.AUTH_METHOD.BASIC);
                        assert.equal(couch.auth.username, username);
                        assert.equal(couch.auth.password, password);
                        assert.equal(couch.auth.user.name, username);
                        assert.equal(user.name, username);
                        assert.equal(user.username, username);
                        assert.equal(user.password, password);
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
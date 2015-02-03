var assert = require('chai').assert,
    potato = require('../potato').potato();

describe('User management', function () {

    var db;

    beforeEach(function (done) {
        potato.reset(function (err) {
            assert.notOk(err);
            potato.getOrCreateDatabase('db', function (err, _db) {
                assert.notOk(err);
                db = _db;
                done();
            });
        });
    });

    describe('create user', function () {

        it('returns a user document', function (done) {
            var username = 'mike',
                password = 'mike';
            potato.createUser({
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
                potato.createUser({
                    username: username,
                    password: password,
                    auth: db.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.notOk(err);
                    var auth = potato.auth;
                    assert.ok(auth, 'auth should be set on successfuly user creation!');
                    assert.equal(auth.method, db.AUTH_METHOD.BASIC);
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

        it('random user, should only be able to get the name', function (done) {
            var username = 'mike',
                password = 'mike';
            potato.createUser({
                username: username,
                password: password
            }, function (err) {
                assert.notOk(err);
                potato.logout();
                potato.getUser('mike', function (err, doc) {
                    assert.ok(doc._id);
                    assert.ok(doc._rev);
                    assert.equal(doc.name, username);
                    done();
                });
            });
        });

        it('no user exists', function (done) {
            potato.getUser('mike', function (err, data) {
                assert.ok(err);
                done();
            });
        });
    });

    describe('auth', function () {

        describe('basic', function () {
            it('fail', function (done) {
                potato.basicAuth({
                    username: 'bob',
                    password: 'yo'
                }, function (err) {
                    assert.ok(err, 'Should be an error');
                    assert.equal(err.status, db.HTTP_STATUS.UNAUTHORISED);
                    assert.notOk(potato.auth);
                    done();
                })
            });
            it('success', function (done) {
                var username = 'mike',
                    password = 'mike';
                potato.createUser({
                    username: username,
                    password: password
                }, function (err) {
                    assert.notOk(err);
                    assert.notOk(potato.auth);
                    potato.basicAuth({
                        username: username,
                        password: password
                    }, function (err, user) {
                        assert.notOk(err);
                        assert.equal(potato.auth.method, potato.AUTH_METHOD.BASIC);
                        assert.equal(potato.auth.username, username);
                        assert.equal(potato.auth.password, password);
                        assert.equal(potato.auth.user.name, username);
                        assert.equal(user.name, username);
                        assert.equal(user.username, username);
                        assert.equal(user.password, password);
                        done();
                    });
                });
            });
            it('logout', function () {
                potato.auth = {};
                assert.ok(potato.auth);
                potato.logout();
                assert.notOk(potato.auth);
            });
        });
        describe('verify', function () {
            it('success', function (done) {
                var username = 'mike',
                    password = 'mike';
                potato.createUser({
                    username: username,
                    password: password,
                    auth: potato.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.notOk(err);
                    potato.verifyAuth(function (err) {
                        assert.notOk(err);
                        done();
                    });
                });
            });
            it('failure if no user exists', function (done) {
                potato.auth = {
                    username: 'blah',
                    password: 'blah',
                    method: db.AUTH_METHOD.BASIC
                };
                potato.verifyAuth(function (err) {
                    assert.ok(err);
                    assert.ok(err.isHttpError);
                    done();
                });
            });
            it('fail if no auth', function (done) {
                potato.verifyAuth(function (err) {
                    assert.ok(err);
                    done();
                });
            })
        });
    });
});
var assert = require('chai').assert,
    Potato = require('../potato'),
    potato = new Potato();

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
            potato.accounts.register({
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
                potato.accounts.register({
                    username: username,
                    password: password,
                    auth: db.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.notOk(err);
                    var auth = potato.auth.auth;
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
            potato.accounts.register({
                username: username,
                password: password
            }, function (err) {
                assert.notOk(err);
                potato.logout();
                potato.accounts.get('mike', function (err, doc) {
                    assert.ok(doc._id);
                    assert.ok(doc._rev);
                    assert.equal(doc.name, username);
                    done();
                });
            });
        });

        it('no user exists', function (done) {
            potato.accounts.get('mike', function (err, data) {
                assert.ok(err);
                done();
            });
        });
    });

    describe('auth', function () {

        describe('basic', function () {
            it('fail', function (done) {
                potato.accounts.login({
                    username: 'bob',
                    password: 'yo',
                    method: Potato.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.ok(err, 'Should be an error');
                    assert.equal(err.status, db.HTTP_STATUS.UNAUTHORISED);
                    assert.notOk(potato.auth.auth);
                    done();
                })
            });
            it('success', function (done) {
                var username = 'mike',
                    password = 'mike';
                potato.accounts.register({
                    username: username,
                    password: password
                }, function (err) {
                    assert.notOk(err);
                    var _authDict = potato.auth.auth;
                    assert.notOk(_authDict);
                    potato.accounts.login({
                        username: username,
                        password: password,
                        method: Potato.AUTH_METHOD.BASIC
                    }, function (err, user) {
                        assert.notOk(err);
                        _authDict = potato.auth.auth;
                        console.log('potato', potato);
                        assert.equal(_authDict.method, potato.AUTH_METHOD.BASIC);
                        assert.equal(_authDict.username, username);
                        assert.equal(_authDict.password, password);
                        assert.equal(_authDict.user.name, username);
                        assert.equal(user.name, username);
                        assert.equal(user.username, username);
                        assert.equal(user.password, password);
                        done();
                    });
                });
            });
            it('logout', function () {
                var auth = potato.auth;
                console.log(potato);
                auth.auth = {};
                assert.ok(auth.auth);
                potato.logout();
                assert.notOk(auth.auth);
            });
        });
        describe('verify', function () {
            it('success', function (done) {
                var username = 'mike',
                    password = 'mike';
                potato.accounts.register({
                    username: username,
                    password: password,
                    auth: potato.AUTH_METHOD.BASIC
                }, function (err) {
                    assert.notOk(err);
                    potato.accounts.verifyAuth(function (err) {
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
                potato.accounts.verifyAuth(function (err) {
                    assert.ok(err);
                    done();
                });
            });
            it('fail if no auth', function (done) {
                potato.accounts.verifyAuth(function (err) {
                    assert.ok(err);
                    done();
                });
            })
        });
    });
});
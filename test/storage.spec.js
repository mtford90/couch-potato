var assert = require('chai').assert,
    Potato = require('../potato'),
    potato = new Potato(),
    prettyJson = require('./util').prettyJson;

describe('storage', function () {

    it('set auth when initialising', function () {
        var auth = {
            username: 'mike',
            password: 'mike',
            method: potato.AUTH_METHOD.BASIC
        };
        var Potato = require('../potato'),
            p = new Potato({auth: auth});
        assert.equal(auth, p.auth.auth);
    });
    it('invalid method', function () {
        var auth = {
            username: 'mike',
            password: 'mike',
            method: 'dsfsdfsdf'
        };
        assert.throws(function () {
            potato({auth: auth});
        }, potato.CouchError);
    });
    describe('basic', function () {
        it('missing password', function () {
            console.log('couchdb', potato);
            var auth = {
                username: 'mike',
                method: potato.AUTH_METHOD.BASIC
            };
            assert.throws(function () {
                potato({auth: auth});
            }, potato.CouchError);
        });
        it('missing username', function () {
            var auth = {
                password: 'mike',
                method: potato.AUTH_METHOD.BASIC
            };
            assert.throws(function () {
                potato({auth: auth});
            }, potato.CouchError);
        });
    });

    describe('event on auth change', function () {
        var db;
        beforeEach(function (done) {
            potato.reset(function (err) {
                assert.notOk(err);
                potato.getOrCreateDatabase('db', {anonymousUpdates: true, anonymousReads: true}, function (err, _db) {
                    assert.notOk(err);
                    db = _db;
                    done();
                });
            });
        });
        it('create user', function (done) {
            potato.once('auth', function (auth) {
                assert.equal(auth.username, 'mike');
                assert.equal(auth.password, 'mike');
                done();
            });
            potato.accounts.register({
                username: 'mike',
                password: 'mike',
                auth: potato.AUTH_METHOD.BASIC
            });
        });

    });
});
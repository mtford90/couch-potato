var assert = require('chai').assert,
    couchdb = require('../potato').couchdb,
    prettyJson = require('./util').prettyJson;

describe('storage', function () {

    it('set auth when initialising', function () {
        var auth = {
            username: 'mike',
            password: 'mike',
            method: couchdb.AUTH_METHOD.BASIC
        };
        var couch = couchdb({auth: auth});
        assert.equal(auth, couch.auth);
    });
    it('invalid method', function () {
        var auth = {
            username: 'mike',
            password: 'mike',
            method: 'dsfsdfsdf'
        };
        assert.throws(function () {
            couchdb({auth: auth});
        }, couchdb.CouchError);
    });
    describe('basic', function () {
        it('missing password', function () {
            console.log('couchdb', couchdb);
            var auth = {
                username: 'mike',
                method: couchdb.AUTH_METHOD.BASIC
            };
            assert.throws(function () {
                couchdb({auth: auth});
            }, couchdb.CouchError);
        });
        it('missing username', function () {
            var auth = {
                password: 'mike',
                method: couchdb.AUTH_METHOD.BASIC
            };
            assert.throws(function () {
                couchdb({auth: auth});
            }, couchdb.CouchError);
        });
    });

    describe('event on auth change', function () {
        var couch = couchdb();
        beforeEach(function (done) {
            couch.reset(function (err) {
                assert.notOk(err);
                couch.createDatabase({anonymousUpdates: true, anonymousReads: true}, function (err) {
                    assert.notOk(err);
                    done();
                });
            });
        });
        it('create user', function (done) {
            couch.once('auth', function (auth) {
                assert.equal(auth.username, 'mike');
                assert.equal(auth.password, 'mike');
                done();
            });
            couch.createUser({
                username: 'mike',
                password: 'mike',
                auth: couch.AUTH_METHOD.BASIC
            });
        });

    });
});
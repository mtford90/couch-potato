var assert = require('chai').assert,
    couchdb = require('../src/couchdb').couchdb,
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

    describe('event on auth change')
});
var assert = require('chai').assert,
    path = require('path');

describe.only('sofa', function () {
    var potato = require('../../potato').couchdb(),
        sofa = require('../../sofa')();


    describe('load config', function () {
        it('from path', function () {
            console.log('sofa', sofa);
            var config = sofa.loadConfig(__dirname + '/fixtures/example');
            console.log('config', config);
        });

        describe('create database', function () {

            it('one database', function (done) {
                potato.reset(function () {
                    sofa.configureCouch({
                        databases: {
                            db: {}
                        }
                    }, function (err) {
                        assert.notOk(err);
                        potato.getDatabase({database: 'db'}, function (err, data) {
                            assert.notOk(err);
                            done();
                        });
                    });
                });
            });

            it('multiple databases', function (done) {
                potato.reset(function () {
                    sofa.configureCouch({
                        databases: {
                            db: {},
                            anotherdb: {}
                        }
                    }, function (err) {
                        assert.notOk(err);
                        potato.getDatabase({database: 'db'}, function (err, data) {
                            assert.notOk(err);
                            potato.getDatabase({database: 'anotherdb'}, function (err, data) {
                                assert.notOk(err);
                                done();
                            });
                        });
                    });
                });
            });
        });

    });


});
/* globals emit*/

var assert = require('chai').assert,
    path = require('path');

describe('sofa', function () {
    var potato = require('../../potato').couchdb(),
        sofa = require('../../sofa')();

    beforeEach(function (done) {
        potato.reset(done);
    });


    describe('load config', function () {
        it('from path', function () {
            console.log('sofa', sofa);
            var config = sofa.loadConfig(__dirname + '/fixtures/example');
            console.log('config', config);
        });

        describe('create database', function () {
            it('one database', function (done) {
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

        describe('design docs', function () {
            it('simple', function (done) {
                sofa.configureCouch({
                    databases: {
                        db: {
                            designDocs: {
                                myDesignDoc: {
                                    views: {
                                        myView: {
                                            map: function (doc) {
                                                emit(doc._id, doc);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }, function (err, doc) {
                    assert.notOk(err);
                    potato.getDesignDocument({
                        name: 'myDesignDoc'
                    }, function (err, doc) {
                        assert.notOk(err);
                        assert.equal(doc._id, '_design/myDesignDoc');
                        assert.ok(doc._rev);
                        assert.ok('myView' in doc.views);
                        done();
                    });
                });
            });
        });

    });


});
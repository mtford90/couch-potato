var assert = require('chai').assert,
    prettyJson = require('./util').prettyJson;

describe('permissions', function () {
    var couch = couchdb();

    describe('_security', function () {
        beforeEach(function (done) {
            couch.admin.reset(function (err) {
                if (!err) {
                    couch.admin.createDatabase(done);
                }
                else done(err);
            });
        });
        it('get default permissions', function (done) {
            couch.admin.getPermissions(function (err, resp) {
                assert.notOk(err);
                console.log('resp', resp);
                done();
            });
        });

    });


    describe('configure database', function () {
        describe('defaults', function () {
            beforeEach(function (done) {
                couch.admin.reset(function (err) {
                    if (!err) {
                        couch.admin.createDatabase(done);
                    }
                    else done(err);
                });
            });
            it('anonymous creation', function (done) {
                couch.upsertDocument({x: 1}, function (err) {
                    assert.notOk(err);
                    done();
                })
            });
            it('anonymous read', function (done) {
                couch.upsertDocument({x: 1}, function (err, doc) {
                    assert.notOk(err);
                    couch.getDocument(doc._id, function (err) {
                        assert.notOk(err);
                        done();
                    });
                })
            });
        });
        describe('no anonymous updates', function () {
            beforeEach(function (done) {
                couch.admin.reset(function (err) {
                    assert.notOk(err, 'Was not expecting error when reseting');
                    couch.admin.createDatabase({anonymousUpdates: false}, function (err) {
                        assert.notOk(err, 'Was not expecting error when creating database...' + prettyJson(err));
                        done();
                    });
                });
            });
            it('anonymous creation should now be forbidden', function (done) {
                couch.upsertDocument({x: 1}, function (err) {
                    assert.ok(err);
                    assert.ok(err.isHttpError);
                    assert.equal(err.status, couch.HTTP_STATUS.FORBIDDEN);
                    done();
                })
            });
            it('anonymous read should still be available', function (done) {
                couch.createUser({username: 'mike', password: 'mike'}, function (err) {
                    assert.notOk(err);
                    couch.basicAuth({
                        username: 'mike',
                        password: 'mike'
                    }, function (err) {
                        assert.notOk(err);
                        couch.upsertDocument({x: 1}, function (err, doc) {
                            assert.notOk(err);
                            couch.logout();
                            couch.getDocument(doc._id, function (err) {
                                assert.notOk(err);
                                done();
                            });
                        })
                    });
                });
            });
        });
        describe('no anonymous reads', function () {
            beforeEach(function (done) {
                couch.admin.reset(function (err) {
                    assert.notOk(err);
                    couch.admin.createDatabase({anonymousReads: false}, done);
                });
            });
            it('anonymous creation should be fine', function (done) {
                couch.upsertDocument({x: 1}, function (err) {
                    assert.notOk(err);
                    done();
                })
            });
            it('anonymous read should now be forbidden', function (done) {
                couch.upsertDocument({x: 1}, function (err, doc) {
                    assert.notOk(err);
                    couch.getDocument(doc._id, function (err) {
                        assert.ok(err);
                        assert.ok(err.isHttpError);
                        assert.equal(err.status, couch.HTTP_STATUS.FORBIDDEN);
                        done();
                    });
                })
            });
        });

        describe('disable both', function () {
            beforeEach(function (done) {
                couch.admin.reset(function (err) {
                    assert.notOk(err);
                    couch.admin.createDatabase({anonymousReads: false, anonymousUpdates: false}, done);
                });
            });
            it('anonymous creation should now be forbidden', function (done) {
                couch.upsertDocument({x: 1}, function (err) {
                    assert.ok(err);
                    assert.ok(err.isHttpError);
                    assert.equal(err.status, couch.HTTP_STATUS.FORBIDDEN);
                    done();
                })
            });

            it('anonymous read should now be forbidden', function (done) {
                couch.createUser({username: 'mike', password: 'mike'}, function (err) {
                    assert.notOk(err);
                    couch.basicAuth({
                        username: 'mike',
                        password: 'mike'
                    }, function (err) {
                        assert.notOk(err);
                        couch.upsertDocument({x: 1}, function (err, doc) {
                            assert.notOk(err);
                            couch.logout();
                            couch.getDocument(doc._id, function (err) {
                                assert.ok(err);
                                assert.ok(err.isHttpError);
                                assert.equal(err.status, couch.HTTP_STATUS.FORBIDDEN);
                                done();
                            });
                        })
                    });
                });
            });
        });


        describe('reenable ', function () {
            beforeEach(function (done) {
                couch.admin.reset(function (err) {
                    assert.notOk(err);
                    couch.admin.createDatabase({anonymousReads: false, anonymousUpdates: false}, done);
                });
            });

            describe('reenable reads', function () {
                beforeEach(function (done) {
                    couch.admin.configureDatabase({
                        anonymousReads: true
                    }, function (err) {
                        assert.notOk(err, 'was not expecting an error when enabling anonymous reads:' + prettyJson(err));
                        done();
                    });
                });
                it('anonymous creation should still be forbidden', function (done) {
                    couch.upsertDocument({x: 1}, function (err) {
                        assert.ok(err);
                        assert.ok(err.isHttpError);
                        assert.equal(err.status, couch.HTTP_STATUS.FORBIDDEN);
                        done();
                    })
                });
                it('anonymous read should still be available', function (done) {
                    couch.createUser({username: 'mike', password: 'mike'}, function (err) {
                        assert.notOk(err);
                        couch.basicAuth({
                            username: 'mike',
                            password: 'mike'
                        }, function (err) {
                            assert.notOk(err);
                            couch.upsertDocument({x: 1}, function (err, doc) {
                                assert.notOk(err);
                                couch.logout();
                                couch.getDocument(doc._id, function (err) {
                                    assert.notOk(err);
                                    done();
                                });
                            })
                        });
                    });
                });
            });

            describe('reenable updates', function () {
                beforeEach(function (done) {
                    couch.admin.configureDatabase({
                        anonymousUpdates: true
                    }, function (err) {
                        assert.notOk(err, 'did not expect an error when reconfiguring: ' + prettyJson(err));
                        done();
                    });
                });

                it('anonymous creation should be fine', function (done) {
                    couch.upsertDocument({x: 1}, function (err) {
                        assert.notOk(err);
                        done();
                    })
                });

                it('anonymous read should now be forbidden', function (done) {
                    couch.upsertDocument({x: 1}, function (err, doc) {
                        assert.notOk(err);
                        couch.getDocument(doc._id, function (err) {
                            assert.ok(err);
                            assert.ok(err.isHttpError);
                            assert.equal(err.status, couch.HTTP_STATUS.FORBIDDEN);
                            done();
                        });
                    })
                });
            });

        });
    });
}); 
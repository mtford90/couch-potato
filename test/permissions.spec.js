var assert = require('chai').assert,
    Potato = require('../potato'),
    potato = new Potato();

describe('permissions', function () {

    describe('_security', function () {
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
        it('get default permissions', function (done) {
            db.getPermissions(function (err) {
                assert.notOk(err);
                done();
            });
        });

    });

    describe('configure database', function () {
        beforeEach(function (done) {
            potato.reset(done);
        });

        describe('anonymous operations', function () {
            describe('no anonymous updates', function () {
                var db;
                beforeEach(function (done) {
                    potato.getOrCreateDatabase('db', {anonymousUpdates: false}, function (err, _db) {
                        assert.notOk(err, 'Was not expecting error when creating database...');
                        db = _db;
                        done();
                    });
                });
                it('anonymous creation should now be forbidden', function (done) {
                    db.post({x: 1}, function (err, resp) {
                        assert.ok(err);
                        assert.equal(err.status, db.HTTP_STATUS.FORBIDDEN);
                        done();
                    })
                });
                it('anonymous read should still be available', function (done) {
                    potato.accounts.register({username: 'mike', password: 'mike'}, function (err) {
                        assert.notOk(err);
                        potato.accounts.login({
                            username: 'mike',
                            password: 'mike',
                            method: Potato.AUTH_METHOD.BASIC
                        }, function (err) {
                            assert.notOk(err, 'Error during basic auth');
                            db.post({x: 1}, function (err, doc) {
                                assert.notOk(err, 'error during posting new object. should work now that authorised!');
                                potato.accounts.logout(function (err) {
                                    assert.notOk(err, 'unexpected error whilst logging out...');
                                    db.get(doc.id, function (err) {
                                        assert.notOk(err);
                                        done();
                                    });
                                });

                            })
                        });
                    });
                });
            });
            describe('no anonymous reads', function () {
                var db;
                beforeEach(function (done) {
                    potato.getOrCreateDatabase('db', {anonymousReads: false}, function (err, _db) {
                        assert.notOk(err);
                        db = _db;
                        done();
                    });
                });
                it('anonymous creation should be fine', function (done) {
                    db.post({x: 1}, function (err) {
                        assert.notOk(err);
                        done();
                    })
                });
                it('anonymous read should now be forbidden', function (done) {
                    db.post({x: 1}, function (err, resp) {
                        assert.notOk(err);
                        var id = resp.id;
                        db.get(id, function (err, doc) {
                            assert.ok(err);
                            assert.equal(err.status, db.HTTP_STATUS.FORBIDDEN);
                            done();
                        });
                    })
                });
            });
            describe('disable both', function () {
                var db;
                beforeEach(function (done) {
                    potato.getOrCreateDatabase('db', {
                        anonymousReads: false,
                        anonymousUpdates: false
                    }, function (err, _db) {
                        assert.notOk(err);
                        db = _db;
                        done();
                    });
                });
                it('anonymous creation should now be forbidden', function (done) {
                    db.post({x: 1}, function (err) {
                        assert.ok(err);
                        assert.equal(err.status, db.HTTP_STATUS.FORBIDDEN);
                        done();
                    })
                });

                it('anonymous read should now be forbidden', function (done) {
                    potato.accounts.register({username: 'mike', password: 'mike'}, function (err) {
                        assert.notOk(err);
                        potato.accounts.login({
                            username: 'mike',
                            password: 'mike',
                            method: Potato.AUTH_METHOD.BASIC
                        }, function (err) {
                            assert.notOk(err);
                            db.post({x: 1}, function (err, resp) {
                                assert.notOk(err);
                                potato.accounts.logout(function (err) {
                                    assert.notOk(err, 'unexpected error when logging out...');
                                    db.get(resp.id, function (err) {
                                        assert.ok(err);
                                        assert.equal(err.status, db.HTTP_STATUS.FORBIDDEN);
                                        done();
                                    });
                                });
                            })
                        });
                    });
                });
            });
            describe('reenable ', function () {
                var db;
                beforeEach(function (done) {
                    potato.reset(function (err) {
                        assert.notOk(err);
                        potato.getOrCreateDatabase('db', {
                            anonymousReads: false,
                            anonymousUpdates: false
                        }, function (err, _db) {
                            assert.notOk(err);
                            db = _db;
                            done();
                        });
                    });
                });

                describe('reenable reads', function () {
                    beforeEach(function (done) {
                        db.configureDatabase({
                            anonymousReads: true
                        }, function (err) {
                            assert.notOk(err, 'was not expecting an error when enabling anonymous reads');
                            done();
                        });
                    });
                    it('anonymous creation should still be forbidden', function (done) {
                        db.post({x: 1}, function (err) {
                            assert.ok(err);
                            assert.equal(err.status, db.HTTP_STATUS.FORBIDDEN);
                            done();
                        })
                    });
                    it('anonymous read should still be available', function (done) {
                        potato.accounts.register({username: 'mike', password: 'mike'}, function (err) {
                            assert.notOk(err);
                            potato.accounts.login({
                                username: 'mike',
                                password: 'mike',
                                method: Potato.AUTH_METHOD.BASIC
                            }, function (err) {
                                assert.notOk(err);
                                db.post({x: 1}, function (err, resp) {
                                    assert.notOk(err);
                                    potato.accounts.logout(function (err) {
                                        assert.notOk(err, 'unexpected error when logging out');
                                        db.get(resp.id, function (err) {
                                            assert.notOk(err);
                                            done();
                                        });
                                    });
                                })
                            });
                        });
                    });
                });

                describe('reenable updates', function () {
                    beforeEach(function (done) {
                        db.configureDatabase({
                            anonymousUpdates: true
                        }, function (err) {
                            assert.notOk(err, 'did not expect an error when reconfiguring');
                            done();
                        });
                    });

                    it('anonymous creation should be fine', function (done) {
                        db.post({x: 1}, function (err) {
                            assert.notOk(err);
                            done();
                        })
                    });

                    it('anonymous read should now be forbidden', function (done) {
                        db.post({x: 1}, function (err, resp) {
                            assert.notOk(err);
                            db.get(resp.id, function (err) {
                                assert.ok(err);
                                assert.equal(err.status, db.HTTP_STATUS.FORBIDDEN);
                                done();
                            });
                        })
                    });
                });

            });
        });
    });
}); 
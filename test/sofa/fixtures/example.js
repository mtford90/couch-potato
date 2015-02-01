/* globals emit */

/**
 * Example Couch Potato configuration.
 * Couch Potato uses javascript code as declaritive configuration.
 * Used with the command line tools to configure CouchDB appropriately.
 */

(function () {
    'use strict';

    module.exports = {
        /**
         * Default admins
         */
        admins: {
            admin: {
                password: 'admin'
            }
        },
        /**
         * Default users
         */
        users: {
            bob: {
                password: 'bob'
            }
        },
        /**
         * Databases that should exist.
         */
        databases: {
            db: {
                // Are unauthenticated users allowed to read documents to this database?
                anonymousReads: false,
                // Are unauthenticated users allowed to add documents to this database?
                anonymousWrites: false,
                /**
                 * Array of documents that exist in the database.
                 * Any documents without an _id will be ignored as this is used to test for existence.
                 */
                documents: [{
                    _id: 'myDoc',
                    key: 'value'
                }],
                /**
                 * Design docs that should exist in this database.
                 * @type Object
                 */
                designDocs: {
                    myDesignDoc: {
                        views: {
                            foo: {
                                map: function (doc) {
                                    emit(doc._id, doc._rev)
                                }
                            }
                        }
                    }
                },
                /**
                 * List of users who are allowed to write documents to this database.
                 * Overrides 'anonymousWrites'
                 *@type Array|null|undefined
                 */
                writeUsers: null,
                /**
                 * List of usernames who are allowed to read documents in this database.
                 * Overrides 'anonymousReads'
                 * @type Array|null|undefined
                 */
                readUsers: null,
                /**
                 * Users with the following roles can add/update documents in this database (assuming that the document is permissioned for them)
                 * @type Array|null|undefined
                 */
                writeRoles: null,
                /**
                 * Users with the following roles can read documents in this database (assuming that the document is permissioned for them)
                 * @type Array|null|undefined
                 */
                readRoles: null
            }
        }
    }
})();
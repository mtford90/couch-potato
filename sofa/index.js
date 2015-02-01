#!/usr/bin/env node

/**
 * This script pulls together sofa into a command line tool after being compiled browserify.
 * Browserify is usually used for pulling together commonjs scripts for the browser however it also
 * works nicely for producing a relocatable node script.
 * By doing this the sofa command line tool can then be used anywhere :)
 */

var argv = require('yargs')
    .usage('Apply a couch potato config to a CouchDB instance.\nUsage: $0')
    .example('$0 -c', 'cp.conf.js')
    .describe('c', 'Specify config file')
    .alias('c', 'config')
    .demand('c')
    .argv;

console.log('argv', argv);

require('./sofa')(argv).loadConfig(argv.config);
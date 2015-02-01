#!/usr/bin/env node

/**
 * This script pulls together sofa into a command line tool after being compiled browserify.
 * Browserify is usually used for pulling together commonjs scripts for the browser however it also
 * works nicely for producing a relocatable node script.
 * By doing this the sofa command line tool can then be used anywhere :)
 */

var yargs = require('yargs'),
    sofa = require('./sofa');

var argv = yargs
    .default('x', 10)
    .default('y', 10)
    .argv;

console.log('argv', argv);
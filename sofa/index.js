#!/usr/bin/env node

/**
 * This script pulls together sofa into a command line tool after being compiled browserify.
 * Browserify is usually used for pulling together commonjs scripts for the browser however it also
 * works nicely for producing a relocatable node script.
 * By doing this the sofa command line tool can then be used anywhere :)
 */

var options = {
    config: {
        short: 'c',
        required: true,
        examples: [
            ['$0 -c', 'cp.conf.js']
        ],
        description: 'Specify config file'
    }
};

var yargs = require('yargs')
    .usage('Apply a couch potato config to a CouchDB instance.\nUsage: $0');

Object.keys(options).forEach(function (name) {
    var conf = options[name],
        short = conf.short,
        required = conf.required,
        description = conf.description,
        examples = conf.examples || [];
    yargs.alias(short, name);
    if (description) yargs.describe(short, description);
    if (required) yargs.demand(short);
    examples.forEach(function (example) {
        yargs.example.apply(yargs, example);
    });
});

var argv = yargs.argv;

require('./sofa')(argv).loadConfig(argv.config);
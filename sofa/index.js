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
        description: 'Specify config file'
    },
    host: {
        short: 'h',
        required: false,
        description: 'Specify host of couchdb instance',
        default: 'localhost'
    },  
    port: {
        short: 'p',
        required: false,
        description: 'Specify port of couchdb instance',
        default: '5984'
    }
};

var examples = [
    ['$0 -p', '5984'],
    ['$0 -h', 'localhost'],
    ['$0 -c', 'cp.conf.js']
];

var yargs = require('yargs')
    .usage('Apply a couch potato config to a CouchDB instance.\nUsage: $0');

Object.keys(options).forEach(function (name) {
    var conf = options[name],
        short = conf.short,
        required = conf.required,
        description = conf.description,
        _default = conf.default,
        examples = conf.examples || [];
    yargs.alias(short, name);
    if (description) yargs.describe(short, description);
    if (required) yargs.demand(short);
    if (_default != undefined) yargs.default(short, _default);

});

examples.forEach(function (example) {
    yargs.example.apply(yargs, example);
});

var argv = yargs.argv;

require('./sofa')(argv).loadConfig(argv.config);
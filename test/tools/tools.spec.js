var assert = require('chai').assert,
    tools = require('../../tools'),
    path = require('path');

describe.only('tools!', function () {
    it('load config', function () {
        console.log('tools', tools);
        var config = tools.loadConfig(__dirname + '/fixtures/couch');
        console.log('config', config);
    });
}); 
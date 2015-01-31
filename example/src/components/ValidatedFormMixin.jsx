(function () {
    'use strict';

    module.exports = {
        validateAll: function () {
            return Object.keys(this.refs).reduce(function (errors, k) {
                var ref = this.refs[k];
                if (ref.validate) var err = ref.validate();
                if (err) errors.push(err);
                return errors;
            }.bind(this), []);
        },
        validateIfHasValue: function () {
            return Object.keys(this.refs).forEach(function (k) {
                this.refs[k].validateIfHasValue();
            }.bind(this));
        },
        enableAll: function () {
            return Object.keys(this.refs).forEach(function (k) {
                this.refs[k].enable();
            }.bind(this));
        },
        disableAll: function () {
            return Object.keys(this.refs).forEach(function (k) {
                this.refs[k].disable();
            }.bind(this));
        },
        validateUsername: function (username) {
            if (username.length < 4) {
                return 'Username must be at least 4 characters long'
            }
        },
        validatePassword: function (password) {
            if (password.length < 8) {
                return 'Password must be at least 8 characters long'
            }
        }
    };
})();
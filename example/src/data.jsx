var auth = localStorage.getItem('auth'),
    couchdb = require('../../front/src/couchdb').couchdb,
    couchPotato = couchdb({auth: auth ? JSON.parse(auth) : null});

var userActions = Reflux.createActions(['changeUser']),
    loginActions = Reflux.createActions(['changeUsername', 'changePassword', 'changeRepeatPassword']),
    userStore = Reflux.createStore({
        init: function () {
            this.listenToMany(userActions);
            this.user = couchPotato.auth ? couchPotato.auth.user : null;
        },
        onChangeUser: function (user) {
            this.user = user;
            this.trigger(this.user);
        }
    }),
    loginStore = Reflux.createStore({
        init: function () {
            this.listenToMany(loginActions);
        },
        onChangeUsername: function (username) {
            console.log('username changed', username);
            this.username = username;
            this._trigger();
        },
        onChangePassword: function (password) {
            this.password = password;
            this._trigger();
        },
        onChangeRepeatPassword: function (repeatPassword) {
            this.repeatPassword = repeatPassword;
            this._trigger();
        },
        _trigger: function () {
            this.trigger({
                username: this.username,
                password: this.password,
                repeatPassword: this.repeatPassword
            })
        }
    });

couchPotato.on('auth', function (auth) {
    console.log('auth changed!');
    localStorage.setItem('auth', auth ? JSON.stringify(auth) : null);
    userActions.changeUser(auth ? auth.user : null);
    loginActions.changeUsername('');
    loginActions.changePassword('');
    loginActions.changeRepeatPassword('');
});

module.exports = {
    couchPotato: couchPotato,
    userActions: userActions,
    loginActions: loginActions,
    userStore: userStore,
    loginStore: loginStore
};
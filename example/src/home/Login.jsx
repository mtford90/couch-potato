/*globals ReactRouter*/


(function () {
    'use strict';
    var ValidatedFormMixin = require('../components/ValidatedFormMixin.jsx'),
        ValidatedInput = require('../components/ValidatedInput.jsx'),
        data = require('../data.jsx'),
        Router = ReactRouter,
        Link = Router.Link;

    module.exports = React.createClass({
        mixins: [Router.State, ValidatedFormMixin],
        render: function () {
            return (<div className="login">
                <form autocomplete="off">
                    <div>
                        <i className="fa fa-user"/>
                        <ValidatedInput
                            type="text"
                            id="username"
                            name="username"
                            placeholder="username"
                            initialValue={data.loginStore.username}
                            onInputChange={data.loginActions.changeUsername.bind(data.loginActions)}
                            ref="username"
                        />
                    </div>
                    <div>
                        <i className="fa fa-lock"/>
                        <ValidatedInput
                            type="password"
                            ref="password"
                            placeholder="password"
                            initialValue={data.loginStore.password}
                            onInputChange={data.loginActions.changePassword.bind(data.loginActions)}
                        />
                    </div>
                </form>
                <div id="buttons">
                    <button onClick={this.onClick}>Login</button>
                    <Link to="sign-up">
                        <button>Sign Up</button>
                    </Link>
                </div>
                <div id="error">
            {this.state.error}
                </div>
            </div>);
        },
        onClick: function () {
            data.couchPotato.basicAuth({
                username: this.refs.username.getValue(),
                password: this.refs.password.getValue()
            }, function (err, user) {
                if (err) {
                    if (err.status == 401) {
                        this.refs.username.validate('Login details incorrect');
                        this.refs.password.validate('Login details incorrect');
                    }
                    else {
                        var message = err.message;
                        this.setState({
                            message: message || 'Unknown Error'
                        });
                    }
                }
                else {
                    console.log('user', user);
                }
            }.bind(this));
        },
        getInitialState: function () {
            return {
                error: ''
            }
        }
    });
})();
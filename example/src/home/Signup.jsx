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
            return (<div className="sign-up">
                <form autocomplete="off">
                    <div>
                        <i className="fa fa-user"/>
                        <ValidatedInput type="text"
                            id="text"
                            name="username"
                            placeholder="username"
                            ref="username"
                            onInputChange={data.loginActions.changeUsername.bind(data.loginActions)}
                            initialValue={data.loginStore.username}
                            validate={this.validateUsername}/>
                    </div>
                    <div>
                        <i className="fa fa-lock"/>
                        <ValidatedInput type="password"
                            placeholder="password"
                            ref="password"
                            onInputChange={data.loginActions.changePassword.bind(data.loginActions)}
                            initialValue={data.loginStore.password}
                            validate={this.validatePassword}/>
                    </div>
                    <div>
                        <i className="fa fa-lock"/>
                        <ValidatedInput type="password"
                            placeholder="repeat password"
                            ref="repeatPassword"
                            onInputChange={data.loginActions.changeRepeatPassword.bind(data.loginActions)}
                            initialValue={data.loginStore.repeatPassword}
                            validate={this.validateRepeatPassword}/>
                    </div>
                </form>
                <div id="buttons">
                    <Link to="login">
                        <button className="icon-button">
                            <i className="fa fa-chevron-left"/>
                        </button>
                    </Link>
                    <button onClick={this.signUp}>Sign Up</button>
                </div>
                <div id="error">
            {this.state.error}
                </div>
            </div>)
        },

        signUp: function () {
            if (!this.validateAll().length) {
                this.disableAll();
                data.couchPotato.createUser({
                    username: this.refs.username.getValue(),
                    password: this.refs.password.getValue(),
                    auth: data.couchPotato.AUTH_METHOD.BASIC
                }, function (err, user) {
                    this.enableAll();
                    if (err) {
                        var message;
                        if (err.status == 409 || err.status == 403 || err.status == 401) {
                            message = 'That user already exists!';
                            this.refs.username.clear();
                            this.refs.username.focus();
                            this.refs.username.validate(message);
                        }
                        else {
                            message = err.message || 'Unknown Error.';
                            this.setState({
                                error: message
                            });
                        }
                    }
                }.bind(this));
            }
        },

        validateRepeatPassword: function (repeatPassword) {
            var password = this.refs.password.getValue();
            if (repeatPassword != password) {
                return 'Passwords do not match'
            }
        },
        getInitialState: function () {
            return {
                error: ''
            }
        },
        componentDidMount: function () {
            this.validateIfHasValue();
        }
    });
})();
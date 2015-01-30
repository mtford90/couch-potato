/*globals ReactRouter*/

var Router = ReactRouter,
    Route = Router.Route,
    DefaultRoute = Router.DefaultRoute,
    NotFoundRoute = Router.NotFoundRoute,
    RouteHandler = Router.RouteHandler,
    Link = Router.Link,
    couchdb = require('../../front/src/couchdb').couchdb,
    merge = require('merge');


var auth = localStorage.getItem('auth'),
    couchPotato = couchdb({auth: auth ? JSON.parse(auth) : null});

console.log('couchPotato auth', couchPotato.auth);


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

var App = React.createClass({
    mixins: [Router.State, Router.Navigation],
    render: function () {
        return (
            <div className="main">
                <RouteHandler/>
            </div>
        );
    },
    componentDidMount: function () {
        var user = userStore.user;
        this.user = user;
        if (user) {
            this.transitionTo('app');
        }
        else {
            this.transitionTo('home');
        }
        userStore.listen(function (user) {
            var loggedOut = !user && this.user;
            if (loggedOut) {
                this.user = null;
                this.transitionTo('home');
            }
            else if (user && !this.user) {
                this.user = user;
                this.transitionTo('app');
            }
            else {
                // Do nothing! The user somehow changed without logging out. Therefore no reason to transition.
            }
        }.bind(this));

    }
});

var ValidatedInputError = React.createClass({
    render: function () {
        return <i className="fa fa-times" ref="error" data-toggle="tooltip" data-original-title={this.props.error} data-placement="right"/>;
    },
    componentDidMount: function () {
        if (this.props.error) {
            $(this.refs.error.getDOMNode()).tooltip();
        }
    }
});

var ValidatedInput = React.createClass({
    render: function () {
        var inputProps = merge({}, this.props);
        inputProps['ref'] = 'input';
        inputProps['onBlur'] = this.onBlur;
        inputProps['onChange'] = this.onChange;
        inputProps['disabled'] = !this.state.inputEnabled;
        inputProps['value'] = this.state.value;
        inputProps['autoComplete'] = 'off';
        var input = React.DOM.input(inputProps);
        return (
            <div className="validated-input">
                {input}
             {this.state.error ? <ValidatedInputError error={this.state.error}/> : ''}
            </div>
        )
    },
    getValue: function () {
        var input = this.refs.input;
        return $(input.getDOMNode()).val();
    },
    validate: function (error) {
        error = error || this.state.validate(this.getValue());
        console.log('error', error);
        this.setState({
            error: error
        });
        return error;
    },
    onBlur: function () {
        this.validateIfHasValue();
    },
    onChange: function () {
        var value = this.getValue();
        if (this.state.error) {
            this.validate();
        }
        this.setState({
            value: value
        });
        this.props.onInputChange(value);
    },
    validateIfHasValue: function () {
        var length = this.getValue().trim().length;
        if (length) {
            console.log(length);
            this.validate();
        }
        else {
            this.setState({
                error: null
            });
        }
    },
    componentDidMount: function () {
        var validate = this.props.validate;
        if (validate) {
            this.setState({
                validate: validate
            });
        }
        var value = this.getValue();
        if (value.trim().length) this.validate();
    },
    // http://stackoverflow.com/questions/12374442/chrome-browser-ignoring-autocomplete-off
    preventAutocompleteInChrome: function () {
        if (navigator.userAgent.toLowerCase().indexOf('chrome') >= 0) {
            this.refs.input.getDOMNode().autocomplete = 'off';
        }
    },
    getDefaultProps: function () {
        return {
            onInputChange: function () {

            }
        };
    },
    getInitialState: function () {
        return {
            validate: this.props.validate || function () {
            },
            error: null,
            inputEnabled: true,
            value: this.props.initialValue
        }
    },
    enable: function () {
        this.setState({
            inputEnabled: true
        });
    },
    disable: function () {
        this.setState({
            inputEnabled: false
        });
    },
    clear: function () {
        $(this.refs.input.getDOMNode()).val('');
    },
    focus: function () {
        $(this.refs.input.getDOMNode()).focus();
    }
});


var ValidatedFormMixin = {
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


var Login = React.createClass({
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
                        initialValue={loginStore.username}
                        onInputChange={loginActions.changeUsername.bind(loginActions)}
                        ref="username"
                    />
                </div>
                <div>
                    <i className="fa fa-lock"/>
                    <ValidatedInput
                        type="password"
                        ref="password"
                        placeholder="password"
                        initialValue={loginStore.password}
                        onInputChange={loginActions.changePassword.bind(loginActions)}
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
        couchPotato.basicAuth({
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


var SignUp = React.createClass({
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
                        onInputChange={loginActions.changeUsername.bind(loginActions)}
                        initialValue={loginStore.username}
                        validate={this.validateUsername}/>
                </div>
                <div>
                    <i className="fa fa-lock"/>
                    <ValidatedInput type="password"
                        id="password"
                        name="password"
                        placeholder="password"
                        ref="password"
                        onInputChange={loginActions.changePassword.bind(loginActions)}
                        initialValue={loginStore.password}
                        validate={this.validatePassword}/>
                </div>
                <div>
                    <i className="fa fa-lock"/>
                    <ValidatedInput type="password"
                        id="repeat-password"
                        name="repeat-password"
                        placeholder="repeat password"
                        ref="repeatPassword"
                        onInputChange={loginActions.changeRepeatPassword.bind(loginActions)}
                        initialValue={loginStore.repeatPassword}
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
            couchPotato.createUser({
                username: this.refs.username.getValue(),
                password: this.refs.password.getValue(),
                auth: couchPotato.AUTH_METHOD.BASIC
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

var Home = React.createClass({
    mixins: [Router.State, Router.Navigation],

    render: function () {
        return (
            <div id="home">
                <div id="inner-home">
                    <div className="header">
                        <h1 className="app-name">
                            Your App
                        </h1>
                        <h3 className="subtitle">
                            ...backed by nothing but CouchDB
                        </h3>
                    </div>
                    <RouteHandler/>
                </div>
            </div>
        );
    },
    componentDidMount: function () {

    },
    getInitialState: function () {
        return {
            login: true
        }
    }
});

var TheApp = React.createClass({
    mixins: [Router.State, Router.Navigation],

    render: function () {
        return (
            <div>
                <span>yo!</span>
                <button onClick={this.onClick}>Logout</button>
            </div>
        )
    },
    onClick: function () {
        couchPotato.logout();
    },
    componentDidMount: function () {
        if (!userStore.user) {
            this.transitionTo('home');
        }
    }
});

var routes = (
    <Route handler={App} >
        <Route name="home" path="/" handler={Home}>
            <Route name="login" path="login" handler={Login}/>
            <Route name="sign-up" path="signup" handler={SignUp}/>
            <DefaultRoute handler={Login}/>
        </Route>
        <Route name="app" path="/app" handler={TheApp}/>
    </Route>
);

Router.run(routes, Router.HashLocation, function (Handler) {
    React.render(<Handler/>, document.body);
});
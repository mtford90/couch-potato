/*globals ReactRouter*/

var Router = ReactRouter,
    Route = Router.Route,
    DefaultRoute = Router.DefaultRoute,
    NotFoundRoute = Router.NotFoundRoute,
    RouteHandler = Router.RouteHandler,
    Link = Router.Link,
    data = require('./data.jsx'),
    merge = require('merge');




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
        var user = data.userStore.user;
        this.user = user;
        if (user) {
            this.transitionTo('app');
        }
        else {
            this.transitionTo('home');
        }
        data.userStore.listen(function (user) {
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
        var user = data.userStore.user;
        this.user = user;
        if (user) {
            this.transitionTo('app');
        }
    },
    getInitialState: function () {
        return {
            login: true
        }
    }
});

var Row = ReactBootstrap.Row,
    Col = ReactBootstrap.Col,
    NavItem = ReactBootstrap.NavItem,
    DropdownButton = ReactBootstrap.DropdownButton,
    MenuItem = ReactBootstrap.MenuItem,
    Navbar = ReactBootstrap.Navbar,
    Nav = ReactBootstrap.Nav;

var TheApp = React.createClass({
    mixins: [Router.State, Router.Navigation],
    render: function () {
        return (
            <div>
                <Navbar>
                    <Nav>
                        <li eventKey={1}>
                            <div className="navbar-header">
                                <span className="navbar-brand" href="#">Your App</span>
                            </div>
                        </li>
                        <li eventKey={2}>
                            <Link to="stream">Stream</Link>
                        </li>
                    </Nav>
                    <div id="profile" className="pull-right">
                        <div className="placeholder">
                            <Link to="profile">
                                <img src="img/placeholder.png" className="placeholder"></img>
                            </Link>
                        </div>
                    </div>
                </Navbar>
                <div className="container">
                    <RouteHandler/>
                </div>
            </div>
        )
    },
    onClick: function () {
        data.couchPotato.logout();
    },
    componentDidMount: function () {
        if (!data.userStore.user) {
            this.transitionTo('home');
        }
    }
});


var Profile = React.createClass({
    mixins: [Reflux.ListenerMixin],
    render: function () {
        return (
            <div className="profile">
                <div className="profile-photo">
                    <img src="img/placeholder.png" className="placeholder"></img>
                </div>
                <div className="username">
                    {this.state.user.name}
                </div>
                <div className="profile">
                    {this.state.user.profile}
                </div>
                <button onClick={data.couchPotato.logout.bind(data.couchPotato)}>Logout</button>
            </div>
        )
    },
    componentDidMount: function () {
        this.listenTo(data.userStore, this.onUserChange);
    },
    onUserChange: function (user) {
        this.setState({
            user: user
        });
    },
    getInitialState: function () {
        return {
            user: data.userStore.user
        }
    }
});


var Stream = React.createClass({
    render: function () {
        return (
            <div className="stream">
                <Row>
                    <input ref="input" type="text" placeholder="add your comment" onKeyDown={this.onKeyDown}/>
                </Row>
            </div>
        )
    },
    onKeyDown: function (e) {
        if (e.keyCode == 13) {
            $(this.refs.input.getDOMNode()).val('');
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
        <Route name="app" path="/app" handler={TheApp}>
            <Route name="profile" path="profile" handler={Profile}/>
            <Route name="stream" path="stream" handler={Stream}/>
            <DefaultRoute handler={Profile}/>
        </Route>
    </Route>
);

Router.run(routes, Router.HashLocation, function (Handler) {
    React.render(<Handler/>, document.body);
});
/*globals ReactRouter*/

var Router = ReactRouter,
    Route = Router.Route,
    DefaultRoute = Router.DefaultRoute,
    NotFoundRoute = Router.NotFoundRoute,
    RouteHandler = Router.RouteHandler,
    Link = Router.Link,
    data = require('./data.jsx'),
    merge = require('merge'),
    Row = ReactBootstrap.Row,
    Col = ReactBootstrap.Col,
    NavItem = ReactBootstrap.NavItem,
    DropdownButton = ReactBootstrap.DropdownButton,
    MenuItem = ReactBootstrap.MenuItem,
    Navbar = ReactBootstrap.Navbar,
    Nav = ReactBootstrap.Nav;

var Login = require('./home/Login.jsx'),
    SignUp = require('./home/Signup.jsx'),
    Home = require('./home/Home.jsx'),
    TheApp = require('./app/App.jsx'),
    Profile = require('./app/Profile.jsx'),
    Stream = require('./app/Stream.jsx');

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
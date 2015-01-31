(function () {
    'use strict';

    var Router = ReactRouter,
        Link = Router.Link,
        data = require('../data.jsx'),
        Navbar = ReactBootstrap.Navbar,
        Nav = ReactBootstrap.Nav,
        RouteHandler = Router.RouteHandler;

    module.exports = React.createClass({
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
})();
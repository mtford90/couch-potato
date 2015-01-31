/*globals ReactRouter*/

(function () {
    'use strict';

    var Router = ReactRouter,
        data = require('../data.jsx'),
        RouteHandler = Router.RouteHandler;

    module.exports = React.createClass({
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
})();
/*globals ReactRouter*/

var Router = ReactRouter,
    Route = Router.Route,
    DefaultRoute = Router.DefaultRoute,
    NotFoundRoute = Router.NotFoundRoute,
    RouteHandler = Router.RouteHandler,
    Link = Router.Link;


var App = React.createClass({
    render: function () {
        return (
            <div>
                <header>
                    <ul>
                        <li>
                            <Link to="home">Home</Link>
                        </li>
                    </ul>
                </header>
                <RouteHandler/>
            </div>
        );
    }
});


var Masonry = React.createClass({
    render: function () {
        return (
            <div ref="container">
                <div class="item"></div>
                <div class="item"></div>
            </div>
        );
    },
    componentDidMount: function () {
        var node = this.refs.container.getDOMNode();
        this.masonry = new Masonry(node, {
            itemSelector: '.item',
            columnWidth: 200
        });
    }
});


var Home = React.createClass({
    render: function () {
        return (
            <div className="home">
                <div className="title">
                    Example
                </div>
                <Masonry/>
            </div>
        );
    }
});


var routes = (
    <Route handler={App} path="/">
        <DefaultRoute handler={Home} />
        <Route name="home" handler={Home} />
        <NotFoundRoute handler={Home}/>
    </Route>
);

Router.run(routes, function (Handler) {
    React.render(<Handler/>, document.body);
});

Router.run(routes, Router.HashLocation, function (Handler) {
    React.render(<Handler/>, document.body);
});
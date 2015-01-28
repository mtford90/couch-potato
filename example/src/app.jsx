/*globals ReactRouter*/

var Router = ReactRouter,
    Route = Router.Route,
    DefaultRoute = Router.DefaultRoute,
    NotFoundRoute = Router.NotFoundRoute,
    RouteHandler = Router.RouteHandler,
    Link = Router.Link;

var masonries = [];

// Set the width of the area and height of the area
var maxWidth = 300,
    maxHeight = 300;


function scaleToFit(width, height) {
    var outputWidth, outputHeight;
    if ((width / height) > (maxWidth / maxHeight)) {
        outputWidth = maxWidth;
        outputHeight = (maxWidth * height) / width;
    }
    else if ((width / height) < (maxWidth / maxHeight)) {
        outputWidth = (maxHeight * width) / height;
        outputHeight = maxHeight;
    }
    else if ((width / height) == (maxWidth / maxHeight)) {
        outputWidth = maxWidth;
        outputHeight = maxHeight;
    }
    return {width: outputWidth, height: outputHeight};
}

var data = [
    {
        url: "http://www.100percentoptical.com/images/2014/10/london.jpg",
        title: 'Red Bus',
        width: 5616,
        height: 3744
    },
    {
        url: "http://ilondonvouchers.com/wp-content/uploads/2014/05/IMG_0214-Copy.jpg",
        title: 'Streets of London',
        width: 560,
        height: 420
    },
    {
        url: "http://www.excel-london.co.uk/media/77990/business1.jpg",
        title: 'Canary Wharf',
        width: 450,
        height: 300
    },
    {
        url: "http://cdni.wired.co.uk/1920x1280/k_n/London_5.jpg",
        title: "The Gherkin",
        width: 1920,
        height: 1080
    },
    {
        url: "http://recruitmentbuzz.co.uk/recruitment/wp-content/uploads/2014/10/r60.jpg",
        title: "Artistic London",
        width: 2048,
        height: 1359
    },
    {
        url: "http://www.digitaluk.co.uk/__data/assets/image/0007/17683/london.jpg",
        title: "Tower Bridge",
        width: 595,
        height: 265
    },
    {
        url: "http://www.dentalorganiser.com/wp-content/uploads/2014/10/london.jpg",
        title: "Tower Bridge Wide",
        width: 1400,
        height: 500
    },
    {
        url: "http://altitudeacquisitions.co.uk/wp-content/uploads/2014/08/london.jpg",
        title: "Telephone Box",
        width: 3024,
        height: 2016
    },
    {
        url: "http://member.aigac.org/images/london2.jpg",
        title: "London Bridge",
        width: 476,
        height: 300
    },
    {
        url: "https://metrouk2.files.wordpress.com/2013/04/ay108339854london-england.jpg",
        title: "London Marathon",
        width: 5184,
        height: 3350
    }
];

/*
 <header>
 <ul>
 <li>
 <Link to="home">Home</Link>
 </li>
 </ul>
 </header>
 */

var App = React.createClass({
    render: function () {
        return (
            <div>
                <RouteHandler/>
            </div>
        );
    }
});

var IMG_PADDING = 5;

var Img = React.createClass({
    render: function () {
        var className = "img";
        if (this.props.hover) className += ' hover';
        else className += ' not-hovered';
        var parentStyle = {
            width: this.props.width,
            height: this.props.height,
            paddingLeft: IMG_PADDING + 'px',
            paddingBottom: IMG_PADDING + 'px'
        };
        var overlayStyle = {
            width: this.props.width - IMG_PADDING,
            height: this.props.height - IMG_PADDING,
            left: IMG_PADDING
        };
        return (
            <div className={className} onMouseOver={this.props.onMouseOver || function () {
            }} onMouseOut={this.props.onMouseOut || function () {
            }}style={parentStyle}>
                <div className="overlay" style={overlayStyle}>
                    <div className="img-title">
                        {this.props.title}
                    </div>
                </div>
                <div className="actual-img" style={{backgroundImage: 'url(' + this.props.src + ')'}}>
                </div>
            </div>
        );
    }
});

var MasonryComp = React.createClass({
    render: function () {
        return (
            <div ref="container">
            {data.map(function (item) {
                var scaled = scaleToFit(item.width, item.height);
                return (
                    <div className="item" style={{width: scaled.width, height: scaled.height}}>
                        <Img onMouseOut={this.onMouseOut} onMouseOver={this.onMouseOver} src={item.url} width={scaled.width} height={scaled.height} title={item.title} hover={this.state.hover}></Img>
                    </div>
                )
            }.bind(this))}
            </div>
        );
    },
    componentDidMount: function () {
        var node = this.refs.container.getDOMNode();
        this.masonry = new Masonry(node, {
            itemSelector: '.item'
        });
        masonries.push(this.masonry);
    },
    componentDidUnmount: function () {
        var idx = masonries.indexOf(this.masonry);
        masonries.splice(idx, 1);
    },
    onMouseOut: function () {
        this.setState({
            hover: false
        })
    },
    onMouseOver: function () {
        this.setState({
            hover: true
        })
    },
    getInitialState: function () {
        return {
            hover: false
        }
    }
});

var Home = React.createClass({
    render: function () {
        return (
            <div className="home">
                <div className="header">
                    <div className="fa fa-chevron-left">
                    </div>
                    <div className="back">
                        Home
                    </div>
                </div>
                <div className="title">
                    London 2015
                </div>
                <MasonryComp/>
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
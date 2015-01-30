/*globals ReactRouter*/

var Router = ReactRouter,
    Route = Router.Route,
    DefaultRoute = Router.DefaultRoute,
    NotFoundRoute = Router.NotFoundRoute,
    RouteHandler = Router.RouteHandler,
    Link = Router.Link;

var masonries = [];

var baseWidth = 300,
    baseHeight = 300,
    maxWidth = baseWidth,
    maxHeight = baseHeight;


var calculateMaxWidth = function () {
    var $main = $('.main');
    var w = $main.width();
    var h = $main.height();
    console.log('w', w);
    console.log('h', h);
    var remainder = w;
    while (remainder >= baseWidth) {
        remainder -= baseWidth;
    }
    console.log('remainder', remainder);
    var numPhotos = Math.floor(w / parseFloat(baseWidth));
    if (numPhotos == 1) {
        maxWidth = w;
    }
    else {
        console.log('numPhotos', numPhotos);
        maxWidth = baseWidth + (remainder / numPhotos);
    }
    console.log('maxWidth', maxWidth);
};

$(window).resize(calculateMaxWidth);

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

function scaleToMatchWidth(width, height) {
    var outputHeight;
    if ((width / height) > (maxWidth / maxHeight)) {
        outputHeight = (maxWidth * height) / width;
    }
    else {
        outputHeight = maxHeight;
    }
    return {width: maxWidth, height: outputHeight};
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
    },
    {
        url: 'http://www.e-architect.co.uk/images/jpgs/london_city/gherkin_london_a071112_a.jpg',
        title: 'Gherkin',
        width: 675,
        height: 900
    },
    {
        url: 'http://moore.se/emil/files/2013/02/london-227602.jpg',
        title: 'Westminster',
        width: 2560,
        height: 1600
    },
    {
        url: 'http://cdn.londonandpartners.com/l-and-p/assets/business/45356-640x360-london_eye_hero.jpg',
        title: 'London Eye',
        width: 640,
        height: 360
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
            <div className="main">
                <RouteHandler/>
            </div>
        );
    }

});

var Img = React.createClass({
    render: function () {
        var className = "img";
        if (this.props.hover) className += ' hover';
        else className += ' not-hovered';
        var parentStyle = {
            width: this.props.width,
            height: this.props.height
        };
        var overlayStyle = {
            width: this.props.width,
            height: this.props.height
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
            <div ref="container" className="masonry">
                <div className="items">
                    {data.map(function (item) {
                        var scaled = scaleToMatchWidth(item.width, item.height);
                        return (
                            <div className="item" style={{width: scaled.width, height: scaled.height}}>
                                <Img onMouseOut={this.onMouseOut}
                                    onMouseOver={this.onMouseOver}
                                    src={item.url}
                                    width={scaled.width} height={scaled.height}
                                    title={item.title}
                                    hover={this.state.hover}></Img>
                            </div>
                        )
                    }.bind(this))}
                </div>
            </div>
        );
    },
    componentDidMount: function () {
        var node = this.refs.container.getDOMNode();
        var $node = $(node);
        this.masonry = $node.masonry({
            itemSelector: '.item',
            isResizeBound: false
        });

        $(window).resize(function () {
            clearTimeout($.data(this, 'resizeTimer'));
            $.data(this, 'resizeTimer', setTimeout(function () {
                if (this._lifeCycleState == 'MOUNTED') {
                    this.setState({}, function () {
                        $node.masonry('layout');
                    });
                }
            }.bind(this), 150));
        }.bind(this));

        calculateMaxWidth();
        this.setState({}, function () {
            $node.masonry('layout');
        });

        //
        //$(window).resize(function () {
        //    if (this._lifeCycleState == 'MOUNTED') {
        //        this.setState({}, function () {
        //            $node.masonry('layout');
        //        });
        //    }
        //}.bind(this));


        //$node.find('.item').each(function (i, itemElem) {
        //    var draggie = new Draggabilly(itemElem);
        //    $node.masonry('bindDraggabillyEvents', draggie);
        //});
        masonries.push(this.masonry);
        if (this.props.showPlaceholder) {
            this.showPlaceholder();
        }
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
    },
    hidePlaceholder: function () {
        var node = this.refs.container.getDOMNode();
        var $node = $(node);
        $node.masonry('remove', this.newElems);
        $node.masonry(); // layout remaining items
        this.newElems = null;
    },
    showPlaceholder: function () {
        var node = this.refs.container.getDOMNode();
        var $node = $(node);
        var newElems = $('<div class="item placeholder" style="width: ' + maxWidth + 'px; height: 200px"><i class="fa fa-picture-o"></i></div>');
        $node.prepend(newElems);
        $node.masonry('prepended', newElems);
        this.newElems = newElems;
    },
    componentWillReceiveProps: function (nextProps) {
        if (this.props.showPlaceholder && !nextProps.showPlaceholder) {
            this.hidePlaceholder();
        }
        else if (!this.props.showPlaceholder && nextProps.showPlaceholder) {
            this.showPlaceholder();
        }
    }
});

var Home = React.createClass({
    render: function () {
        var overlayStyle = this.state.showOverlay ? {
            opacity: 0.7,
            pointerEvents: 'none'
        } : {
            opacity: 0,
            pointerEvents: 'none'
        };
        return (
            <div className="home" onDragEnter={this.onDragEnter} onDragOver={this.onDragOver} onDragLeave={this.onDragLeave} onDrop={this.onDrop}>
                <div className="home-overlay" onMouseOver={this.onMouseOver} style={overlayStyle}>
                {this.state.numFiles + ' files'}
                </div>
                <div className="title">
                    London 2015
                </div>
                <MasonryComp ref="masonry" showPlaceholder={this.state.counter > 0}/>
            </div>
        );
    },
    onMouseOver: function (e) {
        e.preventDefault();
    },
    getInitialState: function () {
        return {
            numFiles: 0,
            counter: 0
        }
    },
    onDragEnter: function (e) {
        this.setState({
            counter: this.state.counter + 1
        });
        e.preventDefault();
        console.log('enter');
    },
    onDragOver: function (e) {
        var x = e.clientX,
            y = e.clientY;
        console.log('(' + x + ',' + y + ')');
        e.preventDefault();
        this.setState({
            isDropping: true
        });
    },
    onDragLeave: function (e) {
        this.setState({
            counter: this.state.counter - 1
        });
        console.log('leave');
        e.preventDefault();
        this.setState({
            isDropping: false
        });
    },

    onDrop: function (e) {
        e.preventDefault();
        console.log('e.dataTransfer', e.dataTransfer);
        var file = e.dataTransfer.files[0],
            reader = new FileReader();
        reader.onload = function (event) {
        };
        console.log(file);
        reader.readAsDataURL(file);
        e.preventDefault();
        this.setState({
            counter: 0
        });
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
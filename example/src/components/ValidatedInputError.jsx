(function () {
    'use strict';

    module.exports = React.createClass({
        render: function () {
            return <i className="fa fa-times" ref="error" data-toggle="tooltip" data-original-title={this.props.error} data-placement="right"/>;
        },
        componentDidMount: function () {
            if (this.props.error) {
                $(this.refs.error.getDOMNode()).tooltip();
            }
        }
    });
})();
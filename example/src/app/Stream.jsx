(function () {
    'use strict';

    var Row = ReactBootstrap.Row;

    module.exports = React.createClass({
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
})();
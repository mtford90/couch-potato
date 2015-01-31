(function () {
    'use strict';

    var ValidatedInputError = require('./ValidatedInputError.jsx'),
        merge = require('merge');

    module.exports = React.createClass({
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


})();
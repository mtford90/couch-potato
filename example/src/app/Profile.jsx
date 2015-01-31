(function () {
    'use strict';

    var ValidatedFormMixin = require('../components/ValidatedFormMixin.jsx'),
        ValidatedInput = require('../components/ValidatedInput.jsx'),
        data = require('../data.jsx');

    module.exports = React.createClass({
        mixins: [Reflux.ListenerMixin],
        render: function () {
            var user = this.state.user,
                name = user ? user.name : '',
                profile = user ? user.profile : '';
            return (
                <div className="profile">
                    <div className="profile-photo">
                        <img src="img/placeholder.png" className="placeholder"></img>
                    </div>
                    <div className="username">
                    {name}
                    </div>
                    <div className="profile">
                    {profile}
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
})();
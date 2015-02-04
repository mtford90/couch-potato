Couchedato
============

...is a set of libraries, tools and guidelines for using CouchDB as a full backend solution.

It isthe perfect starting point for developers without time to waste.

## U wot m8?

CouchDB presents a rich feature set, is highly configurable and  wraps everything up in a lovely REST API - perfect for using directly from the browser.

### Advantages

* **Response Times** 
    * Clients connect directly to the database, cutting out any middlemen. This reduces latency and removes bottlenecks.
    * Map/Reduce based views are constantly updated. Say goodbye to expensive queries that slow your app down to a crawl.
* **Robust**
    * CouchDB is battle tested.
    * It can do most of what you're likely planning on implementing e.g. using express and socket.io. And for free!
* **Security**
    * CouchDB comes with basic, token, session auth and SSL built-in - freeing you from making mistakes.   
* **Development speed**
    * Relax, concentrate on the front-end code and let CouchDB do the rest.

### Disadvantages

* Some flexibility is lost. 
    * ... however in this age of service-oriented architectures there is nothing stopping you adding custom server-side code eventually alongside your couch instance!

## Components

Couch Potato consists of three components. `potato.js` is the interface to CouchDB and can be used from the browser or Node. `sofa.js` is a command-line utility for configuring CouchDB instances and setting up/configuring projects.

### potato.js

`potato.js` is a browser/node library and is the interface to your CouchDB instances. `potato.js` will form the backbone of your apps - whether in the browser or node environment.

Among other things, the `potato` will provision your app with:

* User management
    * Login
    * Logout
    * Sign up
* CRUD operations on documents
* Queries
* ... and much more

### sofa.js

`sofa.js` is a set of command line tools used in configuring your CouchDB instance. From the comfort of your sofa you can do the following:

* Configure design documents.
* Configure permissioning
    * Read/write permissions
    * User roles
* Admin users
* Design documents 
* ... and more

`sofa.js` manages configuration using declarative config files that are plain Javascript. 

### Guidelines

The use of a declarative API makes it much easier to test your map/reduce views.

TODO: Example mocha test

# Caveats

Certain features do not work with plain-old CouchDB. E.g. for read permissions you will need to use rcouch. Note that rcouch will be merged into CouchDB from v2 onwards!

## potato.js

### Install

Install with bower or npm:

```
bower install couch-potato --save
npm install couch-potato --save
```

and then include as a script tag

```html
<script src="bower_components/couch-potato/dist/potato.js"></script>
<script>
var potato = new window.Potato();
</script>
```

or using CommonJS:

```js
var Potato = require('couch-potato'),
	potato = new Potato();
```

### API Documentation

This project is documentation-driven. Not all documented features are yet implemented. You can tell the status of a feature 
by looking at whether it is <span style="color: green">complete</span>, <span style="color: orange">in progress</span>, or <span style="color: red">not started</span>.

#### Init - <span style="color: orange">in progress</span>

`var potato = new Potato(opts)` will create a new instance of the API.

* `[opts.host]` - defaults to `localhost`
* `[opts.port]` - defaults to `5984`
* `[opts.protocol]` - defaults to `http`

e.g:

```js
var potato = new Potato({
	host: 'localhost',
	port: 5984,
	protocol: 'http'
});
```

#### Accounts - <span style="color: orange">in progress</span>

`potato.accounts.register(opts, [cb])` will register a new user with CouchDB instance.

* `opts.username`
* `opts.password`
* `[opts.method]` - If not specified, will need to call `potato.accounts.login(opts)`
	* `Potato.AUTH_METHOD.BASIC`
	* `Potato.AUTH_METHOD.SESSION`

e.g:

```js
potato.accounts.register({
	username: 'mike',
	password: 'abcxyz',
	method: Potato.AUTH_METHOD.BASIC
}, function (err, user) {
	// ...
});
```

`potato.accounts.login.basic(opts, cb)`

* `opts.username`
* `opts.password`

e.g:

```js
potato.accounts.login.basic({
	username: 'mike',
	password: 'abcxyz'
});
```

`potato.accounts.logout([cb])` logs the user out. Authentication details will no longer be sent with the request.

e.g: 

```js
potato.accounts.logout(function (err) {
	// If using basic auth, will return straight away.
	// if using session auth, will disable the session.
});
```

`potato.accounts.get(username, [cb])` returns information about the user with the given username.

#### Database - <span style="color: orange">in progress</span>

`var db = new potato.Database(dbName)` will return a custom [`PouchDB`](http://pouchdb.com/api.html) instance pointing at the database with `dbName`.

e.g.

```js
var potato = new Potato({host: 'localhost', port: 5985}),
	db     = new potato.Database('db');
```

The following`PouchDB` functions will now automatically include authorisation headers as configured by the use of the functions in `potato.account`

* `db.put`
* `db.post`
* `db.delete`
* `db.get`
* `db.putAttachment`
* `db.getAttachment`
* `db.deleteAttachment`
* `db.query`
* `db.bulkDocs`

The following `PouchDB` instances now have additional options around user management:

* `db.put`
* `db.post`
* `db.bulkDocs`

The following options can now be used alongside the usual `PouchDB` options

* `[opts.owner]` - the owner of the document, only the owner can modify `readable`, `writable`, `readableRoles` and `writableRoles`
* `[opts.readable]` - list of users that can read the document
* `[opts.writable]` - list of users that can update/delete the document
* `[opts.readableRoles]` - list of user roles, the members of which can read the document
* `[opts.writableRoles]` - list of user roles, the members of which can update/delete the document 

e.g:

```js
db.put({message: 'blah'}, {owner: 'mike', readable: ['bob', 'john']})
	.then(function (resp) {
		// The following will return 403 Forbidden if the user 
		db.get(resp.id, function (err, doc) {
		
		});		
	});
```

## sofa

### Install

To enable `sofa` on your command-line,

```js
npm install couch-potato -g
```

### Run

And then execute the command line tool like the following:

```bash
sofa -c /path/to/config.js
```

### Configuration

Config files take the following format:

```js
module.exports = {
	// Couch instances to which we will apply this configuration.
	couch: [{
		host: 'localhost',
		port: 5984,
		protocol: 'http'
	}],
	// The administrator details to use when applying this config.
	admin: {username: process.env['ADMIN_USER'], password: process.env['ADMIN_PASS'],
	// Admin users that should exist.
	admins: [
		{username: process.env['ADMIN_USER'], password: process.env['ADMIN_PASS']}
	],
	// Default users to be enabled.
	users: [
		{username: 'bob', password: 'abcxyz', roles: ['awesome']
	],
	// Database configuration
	databases: {
		mydatabase: {
			read: {
				// Do not need to be authorised to read documents.
				anonymous: true,
				// Only the following users are allowed to read documents.
				users: [],
				// Only the following users are allowed to write documents.
				write: []
			},
			write: {
				// Do not need to be authorised to write documents. 
				anonymous: true,
				// Only the following users are allowed to create/update documents.
				users: [],
				// Only users with the following roles are allowed to create/update documents.
				roles: []
			},
			// Design documents
			design: {
				doc: {
					views: {
						count: {
							map: function (doc) {
								emit(doc._id, doc);
							},
							reduce: function (key, value) {
								return length(value);
							}
						}
					}
				}
			}
		}
	}
};
```

## Test Util

One of the benefits of using this approach is that we can test different elements of the CouchDB configuration by loading them into an in-memory couchdb configuration.

TODO

## Roadmap

### 0.1 - Stability

Note: stability refers to lack of bugs as opposed to API stability. API will not be stable until v1.0

### 0.2 - Offline storage

### 0.3 
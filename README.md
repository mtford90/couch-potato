Couch Potato
============

...is a set of libraries, tools and guidelines for using CouchDB as a full backend solution.

It's the perfect companion for developers without time to waste.

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

Among other things, your `potato` will provision your app with:

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
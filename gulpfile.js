var gulp = require('gulp'),
    browserify = require('browserify'),
    connect = require('gulp-connect'),
    open = require('open'),
    through = require('through2'),
    runSequence = require('run-sequence'),
    rename = require('gulp-rename'),
    mocha = require('gulp-mocha'),
    uglify = require('gulp-uglify'),
    source = require('vinyl-source-stream');

// Config
var BUILD_DIR = './build/',
    NODE_LIBS = ['url', 'http'],
    API_BUNDLE = 'bundle.js',
    TEST_BUNDLE = 'test-bundle.js',
    MINIFIED_API_BUNDLE = 'bundle.min.js',
    API_BUNDLE_PATH = BUILD_DIR + API_BUNDLE,
    API_ROOT = './api.js',
    TEST_ROOT = './test/tests.js',
    MINIFIED_API_BUNDLE_PATH = BUILD_DIR + MINIFIED_API_BUNDLE,
    DIST_BUNDLE_NAME = 'couchPotato.js',
    DIST_DIR = './dist',
    DIST_MINIFIED_BUNDLE_NAME = 'couchPotato.min.js',
    WATCH_JS = ['lib/**/*.js', 'api.js'],
    WATCH_TEST_JS = ['test/**/*.spec.js'],
    WATCH_TEST_HTML = ['front/test/**/*.html'];


/**
 * Ensure that all node dependencies are eliminated before generating the browser bundle.
 */
function removeNodeDeps(file) {
    return through(function (buf, enc, next) {
        var str = buf.toString('utf8');
        NODE_LIBS.forEach(function (lib) {
            str = str.replace("require('" + lib + "')", 'null')
                .replace('require("' + lib + '")', 'null');
        });
        this.push(str);
        next();
    });
}

gulp.task('build-api', function () {
    var b = browserify({debug: true});
    b.transform(removeNodeDeps);
    b.add(API_ROOT);
    return b.bundle()
        .pipe(source(API_BUNDLE))
        .pipe(gulp.dest(BUILD_DIR))
        .pipe(connect.reload());
});

gulp.task('build-test', function () {
    var b = browserify({debug: true});
    b.transform(removeNodeDeps);
    b.add(TEST_ROOT);
    b.bundle()
        .pipe(source(TEST_BUNDLE))
        .pipe(gulp.dest(BUILD_DIR))
        .pipe(connect.reload());
});

// Run tests in the node environment.
gulp.task('test-node', function (cb) {
    gulp.src('./test/**/*.spec.js')
        .pipe(mocha({reporter: 'spec'}).on('end', function () {
            cb();
        }))

});

gulp.task('build', ['build-api', 'build-test']);

gulp.task('test', function (cb) {
    // Ran in series due to using the same couchdb database.
    runSequence('test-node', 'build-test', cb);
});

// Same as test, except opens up the browser tests once the node tests have completed.
gulp.task('test-first-time', ['test-server'], function (cb) {
    runSequence('test-node', 'build-test', function () {
        open('http://localhost:7682/front/test');
        cb();
    });
});

gulp.task('test-server', function () {
    connect.server({
        host: 'localhost',
        port: 7682,
        livereload: {
            port: 6597
        }
    });
});

gulp.task('open-tests', function () {
    open('http://localhost:7682/front/test');
});

gulp.task('compile', ['build-api'], function () {
    return gulp.src(API_BUNDLE_PATH)
        .pipe(uglify())
        .pipe(rename(MINIFIED_API_BUNDLE))
        .pipe(gulp.dest(BUILD_DIR));
});

gulp.task('dist', ['compile'], function () {
    gulp.src(API_BUNDLE_PATH)
        .pipe(rename(DIST_BUNDLE_NAME))
        .pipe(gulp.dest(DIST_DIR));
    gulp.src(MINIFIED_API_BUNDLE_PATH)
        .pipe(rename(DIST_MINIFIED_BUNDLE_NAME))
        .pipe(gulp.dest(DIST_DIR));
});

gulp.task('watch', ['test-first-time', 'build'], function () {
    gulp.watch(WATCH_JS, ['test', 'build-couchdb']);
    gulp.watch(WATCH_TEST_JS.concat(WATCH_TEST_HTML), ['test']);
});

gulp.task('watch-browser', ['test-server', 'build-test', 'open-tests'], function () {
    gulp.watch(WATCH_JS, ['build-test']);
    gulp.watch(WATCH_TEST_JS.concat(WATCH_TEST_HTML), ['build-test']);
});


gulp.task('watch-node', ['test-server', 'test-node'], function () {
    gulp.watch(WATCH_JS, ['test-node']);
    gulp.watch(WATCH_TEST_JS, ['test-node']);
});

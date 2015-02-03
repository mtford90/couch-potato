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
    TEST_BUNDLE = 'test-bundle.js',
    POTATO_ROOT = './potato.js',
    TEST_ROOT = './test/tests.js',
    POTATO_BUNDLE_NAME = 'potato.js',
    POTATO_MINIFIED_BUNDLE_NAME = 'potato.min.js',
    POTATO_BUNDLE_PATH = BUILD_DIR + POTATO_BUNDLE_NAME,
    POTATO_MINIFIED_BUNDLE_PATH = BUILD_DIR + POTATO_MINIFIED_BUNDLE_NAME,
    DIST_DIR = './dist',
    WATCH_JS = ['lib/**/*.js', POTATO_BUNDLE_NAME, 'sofa/**/*.js', 'testUtil.js'],
    WATCH_TEST_JS = ['test/**/*.spec.js'],
    WATCH_TEST_HTML = ['test/**/*.html'];

function swallowError(error) {
    console.error(error.toString());
    this.emit('end');
}

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

gulp.task('build-potato', function () {
    var b = browserify({debug: true});
    b.transform(removeNodeDeps);
    b.add(POTATO_ROOT);
    return b.bundle()
        .pipe(source(POTATO_BUNDLE_NAME))
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
gulp.task('test-node', function () {
    gulp.src('./test/**/*.spec.js')
        .pipe(mocha({reporter: 'spec'}))
        .on('error', swallowError)
});

gulp.task('build', ['build-potato', 'build-test']);

gulp.task('test', function (cb) {
    // Ran in series due to using the same couchdb database.
    runSequence('test-node', 'build-test', cb);
});

// Same as test, except opens up the browser tests once the node tests have completed.
gulp.task('test-first-time', ['test-server'], function (cb) {
    runSequence('test-node', 'build-test', function () {
        open('http://localhost:7682/test');
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
    open('http://localhost:7682/test');
});

gulp.task('compile-potato', ['build-potato'], function () {
    return gulp.src(POTATO_BUNDLE_PATH)
        .pipe(uglify())
        .pipe(rename(POTATO_MINIFIED_BUNDLE_NAME))
        .pipe(gulp.dest(BUILD_DIR));
});

gulp.task('compile', ['compile-potato']);

gulp.task('dist', ['compile'], function () {
    return gulp.src([POTATO_BUNDLE_PATH, POTATO_MINIFIED_BUNDLE_PATH])
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

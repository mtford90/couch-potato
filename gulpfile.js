var gulp = require('gulp'),
    browserify = require('browserify'),
    connect = require('gulp-connect'),
    open = require('open'),
    reactify = require('reactify'),
    sass = require('gulp-sass'),
    replace = require('gulp-replace'),
    through = require('through2'),
    runSequence = require('run-sequence'),
    rename = require('gulp-rename'),
    mocha = require('gulp-mocha'),
    uglify = require('gulp-uglify'),
    source = require('vinyl-source-stream');


var NODE_LIBS = ['url', 'http'];

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

gulp.task('build-couchdb', function () {
    var b = browserify({debug: true});
    b.transform(removeNodeDeps);
    b.add('./front/src/couchdb.js');
    return b.bundle()
        .pipe(source('bundle.js'))
        .pipe(gulp.dest('./front/build'))
        .pipe(connect.reload());
});

gulp.task('build-test', function () {
    var b = browserify({debug: true});
    b.transform(removeNodeDeps);
    b.add('./front/test/tests.js');
    b.bundle()
        .pipe(source('test-bundle.js'))
        .pipe(gulp.dest('./front/build'))
        .pipe(connect.reload());
});

gulp.task('build-example', function () {
    var b = browserify({debug: true});
    b.transform(reactify);
    b.add('./example/src/app.jsx');
    return b.bundle()
        .pipe(source('app.js'))
        .pipe(gulp.dest('./example/build'))
        .pipe(connect.reload());
});

gulp.task('sass', function () {
    gulp.src('./example/scss/*.scss')
        .pipe(sass())
        .pipe(gulp.dest('./example/build/css'))
        .pipe(connect.reload());
});

gulp.task('fonts', function () {
    gulp.src('./example/fonts/**/*')
        .pipe(gulp.dest('./example/build/fonts'))
        .pipe(connect.reload());
});

// Run tests in the node environment.
gulp.task('test-node', function (cb) {
    gulp.src('./front/test/**/*.spec.js')
        .pipe(mocha({reporter: 'spec'}).on('end', function () {
            cb();
        }))

});

gulp.task('build', ['build-couchdb', 'build-test']);

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

gulp.task('compile', ['build-couchdb'], function () {
    return gulp.src('./front/build/bundle.js')
        .pipe(uglify())
        .pipe(rename('bundle.min.js'))
        .pipe(gulp.dest('./front/build/'));
});

gulp.task('dist', ['compile'], function () {
    gulp.src('./front/build/bundle.js')
        .pipe(rename('couch.js'))
        .pipe(gulp.dest('./dist'));
    gulp.src('./front/build/bundle.min.js')
        .pipe(rename('couch.min.js'))
        .pipe(gulp.dest('./dist'));
});


gulp.task('watch', ['test-first-time', 'build'], function () {
    gulp.watch(['front/src/**/*.js'], ['test', 'build-couchdb']);
    gulp.watch(['front/test/**/*.js', 'front/test/**/*.html'], ['test']);
});

gulp.task('watch-example', ['build-example', 'sass', 'fonts'], function () {
    connect.server({
        host: 'localhost',
        port: 7683,
        livereload: {
            port: 6598
        }
    });
    open('http://localhost:7683/example');
    gulp.watch(['example/src/**/*.js', 'example/src/**/*.jsx', 'example/index.html'], ['build-example']);
    gulp.watch(['example/scss/**/*.scss'], ['sass']);
    gulp.watch(['example/fonts/**/*'], ['fonts'])
});


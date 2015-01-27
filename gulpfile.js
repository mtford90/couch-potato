var gulp = require('gulp'),
    browserify = require('browserify'),
    connect = require('gulp-connect'),
    open = require('open'),
    source = require('vinyl-source-stream');

gulp.task('build-couchdb', function () {
    return browserify('./front/src/couchdb.js', {debug: true})
        .bundle()
        .pipe(source('bundle.js'))
        .pipe(gulp.dest('./front/build'))
        .pipe(connect.reload());
});

gulp.task('build-test', function () {
    return browserify('./front/test/tests.js', {debug: true})
        .bundle()
        .pipe(source('test-bundle.js'))
        .pipe(gulp.dest('./front/build'))
        .pipe(connect.reload());
});

gulp.task('build', ['build-couchdb', 'build-test']);

gulp.task('watch', ['build'], function () {
    connect.server({
        root: './',
        host: 'localhost',
        port: 7682,
        livereload: {
            port: 6597
        }
    });
    open('http://localhost:7682/front/test');
    gulp.watch(['front/src/**/*.js'], ['build-couchdb']);
    gulp.watch(['front/test/**/*.js', 'front/test/**/*.html'], ['build-test']);
    gulp.watch(['config.js'])
});



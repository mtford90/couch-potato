var gulp = require('gulp'),
    browserify = require('browserify'),
    connect = require('gulp-connect'),
    open = require('open'),
    reactify = require('reactify'),
    sass = require('gulp-sass'),
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
        .pipe(connect.reload())
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
});

gulp.task('watch-example', ['build-example', 'sass', 'fonts'], function () {
    connect.server({
        root: './',
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


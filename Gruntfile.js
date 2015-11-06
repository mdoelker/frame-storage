module.exports = function (grunt) {
    'use strict';

    // Project configuration
    grunt.initConfig({
        // Metadata
        pkg: grunt.file.readJSON('package.json'),
        banner: '/*! <%= pkg.name %> - v<%= pkg.version %> - ' +
            '<%= grunt.template.today("yyyy-mm-dd") %>;' +
            ' Copyright (c) <%= grunt.template.today("yyyy") %> <%= pkg.author.name %>;' +
            ' Licensed <%= pkg.license %> */\n',
        // Task configuration
        uglify: {
            options: {
                banner: '<%= banner %>'
            },
            dist: {
                src: 'frame-storage.js',
                dest: 'frame-storage.min.js'
            }
        },
        jshint: {
            options: {
                node: true,
                curly: true,
                eqeqeq: true,
                immed: true,
                latedef: false,
                newcap: true,
                noarg: true,
                sub: true,
                undef: true,
                unused: true,
                eqnull: true,
                browser: true,
                globals: { define: true },
                boss: true
            },
            gruntfile: {
                src: 'gruntfile.js'
            },
            lib: {
                src: ['frame-storage.js']
            }
        }
    });

    // These plugins provide necessary tasks
    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-contrib-jshint');

    // Default task
    grunt.registerTask('default', ['jshint', 'uglify']);
};


(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.FrameStorage = factory();
    }
}(this, function () {
    "use strict";

    FrameStorage.initChannel = initChannel;
    FrameStorage._callbacks = {};

    return FrameStorage;

    /**
     * Frame Storage
     * @param {string} channelUrl
     * @returns {{setItem: Function, getItem: Function, destroy: Function}}
     * @constructor
     */
    function FrameStorage(channelUrl) {
        var root = document.createElement('div');
        root.id = 'framestorage-' + makeGuid();
        root.style.display = 'none';
        document.body.appendChild(root);

        var buffer = [];
        var targetWindow = null;
        var boundMessageEventHandler, boundSave, boundLoad, boundEmpty, boundCount, boundKey;

        var origin = location.protocol + '//' + location.host;
        var originMatches = channelUrl.match(/^(https?:\/\/[a-z0-9-.:@]+)\/?/i) || [null, origin];
        var channelOrigin = originMatches[1];

        insertIframe({
            root: root,
            url: channelUrl,
            width: 1,
            height: 1,
            onload: function (iframe) {
                targetWindow = iframe.contentWindow;
                boundMessageEventHandler = handleMessageEvent.bind(null, targetWindow);
                boundSave = save.bind(null, targetWindow, channelOrigin);
                boundLoad = load.bind(null, targetWindow, channelOrigin);
                boundEmpty = empty.bind(null, targetWindow, channelOrigin);
                boundCount = count.bind(null, targetWindow, channelOrigin);
                boundKey = key.bind(null, targetWindow, channelOrigin);
                window.addEventListener('message', boundMessageEventHandler, false);

                // Empty buffer
                buffer.forEach(function (item) {
                    switch (item[0]) {
                        case 'save':
                            boundSave.apply(null, item[1]);
                            break;

                        case 'load':
                            boundLoad.apply(null, item[1]);
                            break;

                        case 'empty':
                            boundEmpty.apply(null, item[1]);
                            break;

                        case 'count':
                            boundCount.apply(null, item[1]);
                            break;

                        case 'key':
                            boundKey.apply(null, item[1]);
                            break;
                    }
                });

                buffer = [];
            }
        });

        return {
            getItem: function () {
                if (boundLoad) {
                    boundLoad.apply(null, arguments);
                } else {
                    buffer.push(['load', arguments]);
                }
            },
            setItem: function () {
                if (boundSave) {
                    boundSave.apply(null, arguments);
                } else {
                    buffer.push(['save', arguments]);
                }
            },
            clear: function () {
                if (boundEmpty) {
                    boundEmpty.apply(null, arguments);
                } else {
                    buffer.push(['empty', arguments]);
                }
            },
            length: function () {
                if (boundCount) {
                    boundCount.apply(null, arguments);
                } else {
                    buffer.push(['count', arguments]);
                }
            },
            key: function () {
                if (boundKey) {
                    boundKey.apply(null, arguments);
                } else {
                    buffer.push(['key', arguments]);
                }
            },
            destroy: function () {
                if (root) {
                    document.body.removeChild(root);
                    root = null;
                }

                if (targetWindow) {
                    window.removeEventListener('message', boundMessageEventHandler, false);
                    targetWindow = null;
                }

                boundMessageEventHandler = null;
                boundSave = null;
                boundLoad = null;
            }
        };
    }

    /**
     * Sets up the server part of communication. Has to be called inside
     * of the frame.
     * @param {string} [clientOrigin]
     */
    function initChannel(clientOrigin) {
        if (clientOrigin == null) {
            clientOrigin = '*';
        }

        window.addEventListener('message', function (event) {
            if (clientOrigin !== '*' && event.origin !== clientOrigin) {
                console.error('Origin mismatch');
                return;
            }

            var message = JSON.parse(event.data);
            var sendSuccess = function (value) {
                sendMessage(event.source, {
                    action: 'frameStorageSuccess',
                    ref: message.ref,
                    key: message.key,
                    value: value
                }, clientOrigin);
            };
            var sendError = function (error) {
                sendMessage(event.source, {
                    action: 'frameStorageError',
                    ref: message.ref,
                    key: message.key,
                    message: error.message
                }, clientOrigin);
            };

            switch (message.action) {
                case 'getItem':
                    try {
                        var value = localStorage.getItem(message.key);
                        sendSuccess(value);
                    } catch (err) {
                        sendError(err);
                    }
                    break;

                case 'setItem':
                    try {
                        localStorage.setItem(message.key, message.value);
                        sendSuccess(null);
                    } catch (err) {
                        sendError(err);
                    }
                    break;

                case 'removeItem':
                    try {
                        localStorage.removeItem(message.key);
                        sendSuccess(null);
                    } catch (err) {
                        sendError(err);
                    }
                    break;

                case 'clear':
                    try {
                        localStorage.clear();
                        sendSuccess();
                    } catch (err) {
                        sendError(err);
                    }
                    break;

                case 'length':
                    try {
                        sendSuccess(localStorage.length);
                    } catch (err) {
                        sendError(err);
                    }
                    break;

                case 'key':
                    try {
                        var name = localStorage.key(message.value);
                        sendSuccess(name);
                    } catch (err) {
                        sendError(err);
                    }
                    break;

                default:
                    console.error('Unknown action');
                    return;
            }
        }, false);
    }

    /**
     * Handles incoming messages and passes their data
     * to the registered callbacks.
     * @param {Window} targetWindow
     * @param {Event} event
     */
    function handleMessageEvent(targetWindow, event) {
        if (event.source === targetWindow) {
            var message = JSON.parse(event.data);
            var callback = FrameStorage._callbacks[message.ref] || function () {};

            switch (message.action) {
                case 'frameStorageSuccess':
                    callback(null, message.value);
                    break;

                case 'frameStorageError':
                    callback(message.message, null);
                    break;

                default:
                    console.error('Unknown action');
            }

            delete FrameStorage._callbacks[message.ref];
        }
    }

    /**
     * Communicates with channel to either set or get a value.
     * @param {Window} targetWindow
     * @param {string} origin
     * @param {string} key
     * @param {*} value
     * @param {Function} [cb]
     */
    function save(targetWindow, origin, key, value, cb) {
        var ref = makeGuid();

        if (cb) {
            FrameStorage._callbacks[ref] = cb;
        }

        sendMessage(targetWindow, {
            action: 'setItem',
            ref: ref,
            key: key,
            value: value
        }, origin);
    }

    /**
     * Communicates with channel to load a value.
     * @param {Window} targetWindow
     * @param {string} origin
     * @param {string} key
     * @param {Function} cb
     */
    function load(targetWindow, origin, key, cb) {
        var ref = makeGuid();

        if (cb) {
            FrameStorage._callbacks[ref] = cb;
        } else {
            console.warn('FrameStorage.getItem: Missing callback function');
        }

        sendMessage(targetWindow, {
            action: 'getItem',
            ref: ref,
            key: key
        }, origin);
    }

    /**
     * Communicates with channel to clear all keys.
     * @param {Window} targetWindow
     * @param {string} origin
     * @param {Function} cb
     */
    function empty(targetWindow, origin, cb) {
        var ref = makeGuid();

        if (cb) {
            FrameStorage._callbacks[ref] = cb;
        } else {
            console.warn('FrameStorage.clear: Missing callback function');
        }

        sendMessage(targetWindow, {
            action: 'clear',
            ref: ref
        }, origin);
    }

    /**
     * Communicates with channel to count number of keys.
     * @param {Window} targetWindow
     * @param {string} origin
     * @param {Function} cb
     */
    function count(targetWindow, origin, cb) {
        var ref = makeGuid();

        if (cb) {
            FrameStorage._callbacks[ref] = cb;
        } else {
            console.warn('FrameStorage.length: Missing callback function');
        }

        sendMessage(targetWindow, {
            action: 'length',
            ref: ref
        }, origin);
    }

    /**
     * Communicates with channel to get the key name for the n-th entry.
     * @param {Window} targetWindow
     * @param {string} origin
     * @param {number} value
     * @param {Function} [cb]
     */
    function key(targetWindow, origin, value, cb) {
        var ref = makeGuid();

        if (cb) {
            FrameStorage._callbacks[ref] = cb;
        }

        sendMessage(targetWindow, {
            action: 'key',
            ref: ref,
            value: value
        }, origin);
    }

    /**
     * Send message to channel.
     * @param {Window} targetWindow
     * @param {*} message
     * @param {string} [origin]
     */
    function sendMessage(targetWindow, message, origin) {
        targetWindow.postMessage(JSON.stringify(message), origin);
    }

    /**
     * Generates a weak random ID.
     * @return {string}
     */
    function makeGuid() {
        return 'c' + (Math.random() * (1 << 30)).toString(16).replace('.', '');
    }

    /**
     * Insert a new iframe. Unfortunately, its tricker than you imagine.
     *
     * NOTE: These iframes have no border, overflow hidden and no scrollbars.
     *
     * The opts can contain:
     *   root       DOMElement  required root node (must be empty)
     *   url        String      required iframe src attribute
     *   className  String      optional class attribute
     *   height     Integer     optional height in px
     *   id         String      optional id attribute
     *   name       String      optional name attribute
     *   onload     Function    optional onload handler
     *   width      Integer     optional width in px
     *
     * @access private
     * @param opts {Object} the options described above
     * @see https://github.com/facebookarchive/facebook-js-sdk/blob/deprecated/src/core/content.js
     */
    function insertIframe(opts) {
        //
        // Browsers evolved. Evolution is messy.
        //
        opts.id = opts.id || makeGuid();
        opts.name = opts.name || makeGuid();

        // Dear IE, screw you. Only works with the magical incantations.
        // Dear FF, screw you too. Needs src _after_ DOM insertion.
        // Dear Webkit, you're okay. Works either way.
        var
            guid = makeGuid(),

        // Since we set the src _after_ inserting the iframe node into the DOM,
        // some browsers will fire two onload events, once for the first empty
        // iframe insertion and then again when we set the src. Here some
        // browsers are Webkit browsers which seem to be trying to do the
        // "right thing". So we toggle this boolean right before we expect the
        // correct onload handler to get fired.
            srcSet = false,
            onloadDone = false;
        FrameStorage._callbacks[guid] = function () {
            if (srcSet && !onloadDone) {
                onloadDone = true;
                if (opts.onload) {
                    opts.onload(opts.root.firstChild);
                }
            }
        };

        if (document.attachEvent) {
            var html = (
                '<iframe' +
                ' id="' + opts.id + '"' +
                ' name="' + opts.name + '"' +
                (opts.className ? ' class="' + opts.className + '"' : '') +
                ' style="border:none;' +
                (opts.width ? 'width:' + opts.width + 'px;' : '') +
                (opts.height ? 'height:' + opts.height + 'px;' : '') +
                '"' +
                ' src="' + opts.url + '"' +
                ' frameborder="0"' +
                ' scrolling="no"' +
                ' allowtransparency="true"' +
                ' onload="FrameStorage._callbacks.' + guid + '()"' +
                '></iframe>'
            );

            // There is an IE bug with iframe caching that we have to work around. We
            // need to load a dummy iframe to consume the initial cache stream. The
            // setTimeout actually sets the content to the HTML we created above, and
            // because its the second load, we no longer suffer from cache sickness.
            // It must be javascript:false instead of about:blank, otherwise IE6 will
            // complain in https.
            // Since javascript:false actually result in an iframe containing the
            // string 'false', we set the iframe height to 1px so that it gets loaded
            // but stays invisible.
            opts.root.innerHTML = '<iframe src="javascript:false"' +
                ' frameborder="0"' +
                ' scrolling="no"' +
                ' style="height:1px"></iframe>';

            // Now we'll be setting the real src.
            srcSet = true;

            // You may wonder why this is a setTimeout. Read the IE source if you can
            // somehow get your hands on it, and tell me if you figure it out. This
            // is a continuation of the above trick which apparently does not work if
            // the innerHTML is changed right away. We need to break apart the two
            // with this setTimeout 0 which seems to fix the issue.
            window.setTimeout(function () {
                opts.root.innerHTML = html;
            }, 0);
        } else {
            // This block works for all non IE browsers. But it's specifically
            // designed for FF where we need to set the src after inserting the
            // iframe node into the DOM to prevent cache issues.
            var node = document.createElement('iframe');
            node.id = opts.id;
            node.name = opts.name;
            node.onload = FrameStorage._callbacks[guid];
            node.style.border = 'none';
            node.style.overflow = 'hidden';
            if (opts.className) {
                node.className = opts.className;
            }
            if (opts.height) {
                node.style.height = opts.height + 'px';
            }
            if (opts.width) {
                node.style.width = opts.width + 'px';
            }
            opts.root.appendChild(node);

            // Now we'll be setting the real src.
            srcSet = true;

            node.src = opts.url;
        }
    }

}));

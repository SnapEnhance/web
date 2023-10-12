// ==UserScript==
// @name         SnapEnhance Web
// @version      1.0
// @author       rhunk
// @match        *://web.snapchat.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=snapchat.com
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

/*
AVAILABLE FEATURES : 
- hide bitmoji
- remove effects when away from browser
- download audio notes and images using right click
- prevent typing notification
- prevent read receipts
*/

(function (window) {
    function simpleHook(object, name, proxy) {
        var old = object[name]
        object[name] = proxy(old, object);
    }

    //bypass upload size
    Object.defineProperty(File.prototype, "size", {
        get: function () {
            return 500
        }
    });

    //inject into worker
    function workerInjected() {
        function hookPreRequest(request) {
            if (request.url.endsWith("messagingcoreservice.MessagingCoreService/SendTypingNotification")) {
                console.log("bypassed typing notification")
                return null
            }
            if (request.url.endsWith("messagingcoreservice.MessagingCoreService/UpdateConversation")) {
                console.log("bypassed read receipt")
                return null
            }
            return request
        }

        function _arrayBufferToBase64( buffer ) {
            var binary = '';
            var bytes = new Uint8Array( buffer );
            var len = bytes.byteLength;
            for (var i = 0; i < len; i++) {
                binary += String.fromCharCode( bytes[ i ] );
            }
            return btoa( binary );
        }

        async function hookPostRequest(request, response) {
            if (request.headers && request.headers.get("content-type") == "application/grpc-web+proto") {
                let arrayBuffer = await response.arrayBuffer()
                console.log("Response", response.url, _arrayBufferToBase64(arrayBuffer))
                response.arrayBuffer = async () => arrayBuffer
            }
            return response
        }

        //hook websocket (hide bitmoji)
        WebSocket.prototype.send = new Proxy(WebSocket.prototype.send, {
            apply: function (target, thisArg, argumentsList) {
                console.log("WebSocket send", argumentsList[0])
                //return target.apply(thisArg, argumentsList);
            }
        });

        //hook worker web requests
        const oldFetch = fetch
        fetch = async (...args) => {
            args[0] = hookPreRequest(...args)
            if (args[0] == null) {
                throw Error()
            }
            let requestBody = args[0].body

            console.log(args[0])

            if (requestBody && !requestBody.locked) {
                const buffer = await requestBody.getReader().read()
                if (buffer.value) {
                    console.log("Request", args[0].url, _arrayBufferToBase64(buffer.value))
                }
                args[0] = new Request(args[0], {
                    body: buffer.value,
                    headers: args[0].headers
                })
            }

            let result = oldFetch(...args);

            return new Promise(async (resolve, reject) => {
                try {
                    resolve(await hookPostRequest(args[0], await result))
                } catch (e) {
                    console.info("Fetch error", e)
                    reject(e)
                }
            })
        }
    }

    const oldBlobClass = window.Blob

    window.Blob = class HookedBlob extends Blob {
        constructor(...args) {
            const data = args[0][0]
            if (typeof data == "string" && data.startsWith("importScripts")) {
                args[0][0] += workerInjected.toString() + ";workerInjected();"
                window.Blob = oldBlobClass
            }
            super(...args)
        }
    }

    simpleHook(document, "createElement", (proxy, instance) => (...args) => {
        let result = proxy.call(instance, ...args)

        //allow audio note and image download
        if (args[0] == "audio" || args[0] == "video" || args[0] == "img") {
            simpleHook(result, "setAttribute", (proxy2, instance2) => (...args2) => {
                if (args2[0] == "controlsList") return
                proxy2.call(instance2, ...args2)
            });
            result.addEventListener("contextmenu", event => {
                event.stopImmediatePropagation()
            })
        }

        return result
    });

    // always focused
    simpleHook(document, "hasFocus", () => () => true)

    const oldAddEventListener = EventTarget.prototype.addEventListener
    Object.defineProperty(EventTarget.prototype, "addEventListener", {
        value: function (...args) {
            let eventName = args[0]
            if (eventName == "keydown") return
            if (eventName == "focus") return
            return oldAddEventListener.call(this, ...args)
        }
    })
})(window.unsafeWindow || window);

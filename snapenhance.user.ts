// ==UserScript==
// @name         SnapEnhance Web
// @namespace    snapenhance-web
// @description  A userscript to Enhance the User experience on Snapchat Web
// @version      1.1.0
// @author       SnapEnhance
// @source       https://github.com/SnapEnhance/web/
// @license      GPL-3.0-only
// @supportURL   https://github.com/SnapEnhance/web/issues
// @updateURL    https://github.com/SnapEnhance/web/releases/latest/download/snapenhance.user.js
// @match        *://web.snapchat.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=snapchat.com
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==
(function (window: any) {
    function simpleHook(object: any, name: string, proxy: Function) {
        const old = object[name];
        object[name] = proxy(old, object);
    }

    // Bypass upload size
    Object.defineProperty(File.prototype, "size", {
        get: function () {
            return 500;
        }
    });


    // hook main window requests
    const oldWindowFetch = window.fetch

    window.fetch = (...args: any[]) => {
        const url = args[0].url;
        
        if (typeof url === "string") {
            if (url.endsWith("readreceipt-indexer/batchuploadreadreceipts")) {
                console.log("bypassed story read receipt");
                return new Promise((resolve) => resolve(new Response(null, { status: 200 })));
            }
        }
        
        return oldWindowFetch(...args);
    }

    // Inject into worker
    function workerInjected() {
        function hookPreRequest(request: Request) {
            if (request.url.endsWith("messagingcoreservice.MessagingCoreService/SendTypingNotification")) {
                console.log("bypassed typing notification");
                return null;
            }
            if (request.url.endsWith("messagingcoreservice.MessagingCoreService/UpdateConversation")) {
                console.log("bypassed conversation read receipt");
                return null;
            }
            return request;
        }

        async function hookPostRequest(request: Request, response: Response) {
            if (request.headers && request.headers.get("content-type") === "application/grpc-web+proto") {
                const arrayBuffer = await response.arrayBuffer();
                response.arrayBuffer = async () => arrayBuffer;
            }
            return response;
        }

        // Hook websocket (hide bitmoji)
        WebSocket.prototype.send = new Proxy(WebSocket.prototype.send, {
            apply: function (target, thisArg, argumentsList) {
                console.log("WebSocket send", argumentsList[0]);
                // return target.apply(thisArg, argumentsList);
            }
        });

        // Hook worker web requests
        const oldFetch = fetch;
        // @ts-ignore 
        // eslint-disable-next-line no-implicit-globals
        fetch = async (...args: any[]) => {
            args[0] = hookPreRequest(args[0]);
            if (args[0] == null) {
                return new Promise((resolve) => resolve(new Response(null, { status: 200 })));
            }
            const requestBody = args[0].body;

            if (requestBody && !requestBody.locked) {
                const buffer = await requestBody.getReader().read();
                args[0] = new Request(args[0], {
                    body: buffer.value,
                    headers: args[0].headers
                });
            }

            // @ts-ignore
            const result = oldFetch(...args);

            return new Promise(async (resolve, reject) => {
                try {
                    resolve(await hookPostRequest(args[0], await result));
                } catch (e) {
                    console.info("Fetch error", e);
                    reject(e);
                }
            });
        };
    }

    const oldBlobClass = window.Blob;

    window.Blob = class HookedBlob extends Blob {
        constructor(...args: any[]) {
            const data = args[0][0];
            if (typeof data === "string" && data.startsWith("importScripts")) {
                args[0][0] += `${workerInjected.toString()};workerInjected();`;
                window.Blob = oldBlobClass;
            }
            super(...args);
        }
    };

    simpleHook(document, "createElement", (proxy: Function, instance: any) => (...args: any[]) => {
        const result = proxy.call(instance, ...args);

        // Allow audio note and image download
        if (args[0] === "audio" || args[0] === "video" || args[0] === "img") {
            simpleHook(result, "setAttribute", (proxy2: Function, instance2: any) => (...args2: any[]) => {
                result.style = "pointer-events: auto;"
                if (args2[0] === "controlsList") return
                proxy2.call(instance2, ...args2);
            });
            
            result.addEventListener("load", (_: Event) => {
                result.parentElement?.addEventListener("contextmenu", (event: Event) => {
                    event.stopImmediatePropagation();
                });
            });

            result.addEventListener("contextmenu", (event: Event) => {
                event.stopImmediatePropagation();
            });
        }

        return result;
    });

    // Always focused
    simpleHook(document, "hasFocus", () => () => true);

    const oldAddEventListener = EventTarget.prototype.addEventListener;
    Object.defineProperty(EventTarget.prototype, "addEventListener", {
        value: function (...args: any[]) {
            const eventName = args[0];
            if (eventName === "keydown") return;
            if (eventName === "focus") return;
            return oldAddEventListener.call(this, ...args);
        }
    });
})(window.unsafeWindow || window);

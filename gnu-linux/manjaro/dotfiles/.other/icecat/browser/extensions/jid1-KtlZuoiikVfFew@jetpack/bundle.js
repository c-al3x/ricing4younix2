(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
*
* Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
  Singleton to handle external licenses, e.g. WebLabels
*/

"use strict";

let licensesByLabel = new Map();
let licensesByUrl = new Map();
{
  let {licenses} = require("../license_definitions");
  let mapByLabel = (label, license) => licensesByLabel.set(label.toUpperCase(), license);
  for (let [id, l] of Object.entries(licenses)) {
    let {identifier, canonicalUrl, licenseName} = l;
    if (identifier) {
      mapByLabel(identifier, l);
    } else {
      l.identifier = id;
    }
    if (id !== identifier) {
      mapByLabel(id, l);
    }
    if (licenseName) {
      mapByLabel(licenseName, l);
    }
    if (Array.isArray(canonicalUrl)) {
      for (let url of canonicalUrl) {
        licensesByUrl.set(url, l);
      }
    }
  }
}

let cachedHrefs = new Map();

var ExternalLicenses = {
  purgeCache(tabId) {
    cachedHrefs.delete(tabId);
  },

  async check(script) {
    let {url, tabId, frameId, documentUrl} = script;
    let tabCache = cachedHrefs.get(tabId);
    let frameCache = tabCache && tabCache.get(frameId);
    let cache = frameCache && frameCache.get(documentUrl);
    let scriptInfo = await browser.tabs.sendMessage(tabId, {
      action: "checkLicensedScript",
      url,
      cache,
    }, {frameId});

    if (!(scriptInfo && scriptInfo.licenseLinks.length)) {
      return null;
    }
    scriptInfo.licenses = new Set();
    scriptInfo.toString = function() {
      let licenseIds = [...this.licenses].map(l => l.identifier).sort().join(", ");
      return licenseIds
         ? `Free license${this.licenses.size > 1 ? "s" : ""} (${licenseIds})`
         : "Unknown license(s)";
    }
    let match = (map, key) => {
      if (map.has(key)) {
        scriptInfo.licenses.add(map.get(key));
        return true;
      }
      return false;
    };

    for (let {label, url} of scriptInfo.licenseLinks) {
      match(licensesByLabel, label = label.trim().toUpperCase()) ||
        match(licensesByUrl, url) ||
        match(licensesByLabel, label.replace(/^GNU-|-(?:OR-LATER|ONLY)$/, ''));
    }
    scriptInfo.free = scriptInfo.licenses.size > 0;
    return scriptInfo;
  },

  /**
  * moves / creates external license references before any script in the page
  * if needed, to have them ready when the first script load is triggered.
  * It also caches the external licens href by page URL, to help not actually
  * modify the rendered HTML but rather feed the content script on demand.
  * Returns true if the document has been actually modified, false otherwise.
  */
  optimizeDocument(document, cachePointer) {
    let cache = {};
    let {tabId, frameId, documentUrl} = cachePointer;
    let frameCache = cachedHrefs.get(tabId);
    if (!frameCache) {
      cachedHrefs.set(tabId, frameCache = new Map());
    }
    frameCache.set(frameId, new Map([[documentUrl, cache]]));

    let link = document.querySelector(`link[rel="jslicense"], link[data-jslicense="1"], a[rel="jslicense"], a[data-jslicense="1"]`);
    if (link) {
      let href = link.getAttribute("href");
      cache.webLabels = {href};
      let move = () => !!document.head.insertBefore(link, document.head.firstChild);
      if (link.parentNode === document.head) {
        for (let node; node = link.previousElementSibling;) {
          if (node.tagName.toUpperCase() === "SCRIPT") {
            return move();
          }
        }
      } else { // the reference is only in the body
        if (link.tagName.toUpperCase() === "A") {
          let newLink = document.createElement("link");
          newLink.rel = "jslicense";
          newLink.setAttribute("href", href);
          link = newLink;
        }
        return move();
      }
    }

    return false;
  }
};


module.exports = { ExternalLicenses };

},{"../license_definitions":10}],2:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
*
* Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

/*
  A class to manage whitelist/blacklist operations
*/

let {ListStore} = require("../common/Storage");

class ListManager {
  constructor(whitelist, blacklist, builtInHashes) {
    this.lists = {whitelist, blacklist};
    this.builtInHashes = new Set(builtInHashes);
  }

  static async move(fromList, toList, ...keys) {
    await Promise.all([fromList.remove(...keys), toList.store(...keys)]);
  }

  async whitelist(...keys) {
    await ListManager.move(this.lists.blacklist, this.lists.whitelist, ...keys);
  }
  async blacklist(...keys) {
    await ListManager.move(this.lists.whitelist, this.lists.blacklist, ...keys);
  }
  async forget(...keys) {
    await Promise.all(Object.values(this.lists).map(async l => await l.remove(...keys)));
  }
  /* key is a string representing either a URL or an optional path
    with a trailing (hash).
    Returns "blacklisted", "whitelisted" or defValue
  */
  getStatus(key, defValue = "unknown") {
    let {blacklist, whitelist} = this.lists;
    let inline = ListStore.inlineItem(key);
    if (inline) {
      return blacklist.contains(inline)
        ? "blacklisted"
        : whitelist.contains(inline) ? "whitelisted"
        : defValue;
    }

    let match = key.match(/\(([^)]+)\)(?=[^()]*$)/);
    if (!match) {
      let url = ListStore.urlItem(key);
      let site = ListStore.siteItem(key);
      return (blacklist.contains(url) || ListManager.siteMatch(site, blacklist)
        ? "blacklisted"
        : whitelist.contains(url) || ListManager.siteMatch(site, whitelist)
        ? "whitelisted" : defValue
      );
    }

  	let [hashItem, srcHash] = match; // (hash), hash
  	return blacklist.contains(hashItem) ? "blacklisted"
  			: this.builtInHashes.has(srcHash) || whitelist.contains(hashItem)
        ? "whitelisted"
  			: defValue;
  	}

    /*
      Matches by whole site ("http://some.domain.com/*") supporting also
      wildcarded subdomains ("https://*.domain.com/*").
    */
    static siteMatch(url, list) {
      let site = ListStore.siteItem(url);
      if (list.contains(site)) {
        return site;
      }
      site = site.replace(/^([\w-]+:\/\/)?(\w)/, "$1*.$2");
      for (;;) {
        if (list.contains(site)) {
          return site;
        }
        let oldKey = site;
        site = site.replace(/(?:\*\.)*\w+(?=\.)/, "*");
        if (site === oldKey) {
          return null;
        }
      }
    }
}

module.exports = { ListManager };

},{"../common/Storage":5}],3:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
*
* Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
  This class parses HTTP response headers to extract both the
  MIME Content-type and the character set to be used, if specified,
  to parse textual data through a decoder.
*/

const BOM = [0xEF, 0xBB, 0xBF];
const DECODER_PARAMS = {stream: true};

class ResponseMetaData {
  constructor(request) {
    let {responseHeaders} = request;
    this.headers = {};
    for (let h of responseHeaders) {
      if (/^\s*Content-(Type|Disposition)\s*$/i.test(h.name)) {
        let propertyName =  h.name.split("-")[1].trim();
        propertyName = `content${propertyName.charAt(0).toUpperCase()}${propertyName.substring(1).toLowerCase()}`;
        this[propertyName] = h.value;
        this.headers[propertyName] = h;
      }
    }
    this.computedCharset = "";
  }

  get charset() {
    let charset = "";
    if (this.contentType) {
      let m = this.contentType.match(/;\s*charset\s*=\s*(\S+)/);
      if (m) {
        charset = m[1];
      }
    }
    Object.defineProperty(this, "charset", { value: charset, writable: false, configurable: true });
    return this.computedCharset = charset;
  }

  decode(data) {
    let charset = this.charset;
    let decoder = this.createDecoder();
    let text = decoder.decode(data, DECODER_PARAMS);
    if (!charset && /html/i.test(this.contentType)) {
      // missing HTTP charset, sniffing in content...

      if (data[0] === BOM[0] && data[1] === BOM[1] && data[2] === BOM[2]) {
        // forced UTF-8, nothing to do
        return text;
      }

      // let's try figuring out the charset from <meta> tags
      let parser = new DOMParser();
      let doc = parser.parseFromString(text, "text/html");
      let meta = doc.querySelectorAll('meta[charset], meta[http-equiv="content-type"], meta[content*="charset"]');
      for (let m of meta) {
        charset = m.getAttribute("charset");
        if (!charset) {
          let match = m.getAttribute("content").match(/;\s*charset\s*=\s*([\w-]+)/i)
          if (match) charset = match[1];
        }
        if (charset) {
          decoder = this.createDecoder(charset, null);
          if (decoder) {
            this.computedCharset = charset;
            return decoder.decode(data, DECODER_PARAMS);
          }
        }
      }
    }
    return text;
  }

  createDecoder(charset = this.charset, def = "latin1") {
    if (charset) {
      try {
        return new TextDecoder(charset);
      } catch (e) {
        console.error(e);
      }
    }
    return def ? new TextDecoder(def) : null;
  }
};
ResponseMetaData.UTF8BOM = new Uint8Array(BOM);

module.exports = { ResponseMetaData };

},{}],4:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
*
* Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
  An abstraction layer over the StreamFilter API, allowing its clients to process
  only the "interesting" HTML and script requests and leaving the other alone
*/

let {ResponseMetaData} = require("./ResponseMetaData");

let listeners = new WeakMap();
let webRequestEvent = browser.webRequest.onHeadersReceived;

class ResponseProcessor {

  static install(handler, types = ["main_frame", "sub_frame", "script"]) {
    if (listeners.has(handler)) return false;
    let listener =
      async request =>  await new ResponseTextFilter(request).process(handler);
    listeners.set(handler, listener);
    webRequestEvent.addListener(
  		listener,
  		{urls: ["<all_urls>"], types},
  		["blocking", "responseHeaders"]
  	);
    return true;
  }

  static uninstall(handler) {
    let listener = listeners.get(handler);
    if (listener) {
      webRequestEvent.removeListener(listener);
    }
  }
}

Object.assign(ResponseProcessor, {
  // control flow values to be returned by handler.pre() callbacks
	ACCEPT: {},
	REJECT: {cancel: true},
	CONTINUE: null
});

class ResponseTextFilter {
  constructor(request) {
    this.request = request;
    let {type, statusCode} = request;
    let md = this.metaData = new ResponseMetaData(request);
    this.canProcess = // we want to process html documents and scripts only
      (statusCode < 300 || statusCode >= 400) && // skip redirections
      !md.disposition && // skip forced downloads
      (type === "script" || /\bhtml\b/i.test(md.contentType));
  }

  async process(handler) {
    if (!this.canProcess) return ResponseProcessor.ACCEPT;
    let {metaData, request} = this;
    let response = {request, metaData}; // we keep it around allowing callbacks to store state
    if (typeof handler.pre === "function") {
      let res = await handler.pre(response);
      if (res) return res;
      if (handler.post) handler = handler.post;
      if (typeof handler !== "function") return ResponseProcessor.ACCEPT;
    }

    let {requestId, responseHeaders} = request;
    let filter = browser.webRequest.filterResponseData(requestId);
    let buffer = [];

    filter.ondata = event => {
      buffer.push(event.data);
    };

    filter.onstop = async event => {
      // concatenate chunks
      let size = buffer.reduce((sum, chunk, n) => sum + chunk.byteLength, 0)
      let allBytes = new Uint8Array(size);
      let pos = 0;
      for (let chunk of buffer) {
        allBytes.set(new Uint8Array(chunk), pos);
        pos += chunk.byteLength;
      }
      buffer = null; // allow garbage collection
      if (allBytes.indexOf(0) !== -1) {
        console.debug("Warning: zeroes in bytestream, probable cached encoding mismatch.", request);
        if (request.type === "script") {
          console.debug("It's a script, trying to refetch it.");
          response.text = await (await fetch(request.url, {cache: "reload", credentials: "include"})).text();
        } else {
          console.debug("It's a %s, trying to decode it as UTF-16.", request.type);
          response.text = new TextDecoder("utf-16be").decode(allBytes, {stream: true});
        }
      } else {
        response.text = metaData.decode(allBytes);
      }
      let editedText = null;
      try {
        editedText = await handler(response);
      } catch(e) {
        console.error(e);
      }
      if (editedText !== null) {
        // we changed the content, let's re-encode
        let encoded = new TextEncoder().encode(editedText);
        // pre-pending the UTF-8 BOM will force the charset per HTML 5 specs
        allBytes = new Uint8Array(encoded.byteLength + 3);
        allBytes.set(ResponseMetaData.UTF8BOM, 0); // UTF-8 BOM
        allBytes.set(encoded, 3);
      }
      filter.write(allBytes);
      filter.close();
    }

    return ResponseProcessor.ACCEPT;
  }
}

module.exports = { ResponseProcessor };

},{"./ResponseMetaData":3}],5:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
*
* Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

/**
 A tiny wrapper around extensions storage API, supporting CSV serialization for
 retro-compatibility
*/
"use strict";

var Storage = {
  ARRAY: {
    async load(key, array = undefined) {
      if (array === undefined) {
        array = (await browser.storage.local.get(key))[key];
      }
      return array ? new Set(array) : new Set();
    },
    async save(key, list) {
      return await browser.storage.local.set({[key]: [...list]});
    },
  },

  CSV: {
    async load(key) {
      let csv = (await browser.storage.local.get(key))[key];
      return csv ? new Set(csv.split(/\s*,\s*/)) : new Set();
    },

    async save(key, list) {
      return await browser.storage.local.set({[key]: [...list].join(",")});
    }
  }
};

/**
  A class to hold and persist blacklists and whitelists
*/

class ListStore {
  constructor(key, storage = Storage.ARRAY) {
    this.key = key;
    this.storage = storage;
    this.items = new Set();
    browser.storage.onChanged.addListener(changes => {
      if (!this.saving && this.key in changes) {
        this.load(changes[this.key].newValue);
      }
    });
  }

  static inlineItem(url) {
    // here we simplify and hash inline script references
    return url.startsWith("inline:") ? url
      : url.startsWith("view-source:")
        && url.replace(/^view-source:[\w-+]+:\/+([^/]+).*#line\d+/,"inline://$1#")
              .replace(/\n[^]*/, s => s.replace(/\s+/g, ' ').substring(0, 16) + "…" + hash(s.trim()));
  }
  static hashItem(hash) {
    return hash.startsWith("(") ? hash : `(${hash})`;
  }
  static urlItem(url) {
    let queryPos = url.indexOf("?");
    return queryPos === -1 ? url : url.substring(0, queryPos);
  }
  static siteItem(url) {
    if (url.endsWith("/*")) return url;
    try {
      return `${new URL(url).origin}/*`;
    } catch (e) {
      return `${url}/*`;
    }
  }

  async save() {
    this._saving = true;
    try {
      return await this.storage.save(this.key, this.items);
    } finally {
      this._saving = false;
    }
  }

  async load(values = undefined) {
    try {
      this.items = await this.storage.load(this.key, values);
    } catch (e) {
      console.error(e);
    }
    return this.items;
  }

  async store(...items) {
    let size = this.items.size;
    let changed = false;
    for (let item of items) {
      if (size !== this.items.add(item).size) {
        changed = true;
      }
    }
    return changed && await this.save();
  }

  async remove(...items) {
    let changed = false;
    for (let item of items) {
      if (this.items.delete(item)) {
        changed = true;
      }
    }
    return changed && await this.save();
  }

  contains(item) {
    return this.items.has(item);
  }
}

function hash(source){
	var shaObj = new jssha("SHA-256","TEXT")
	shaObj.update(source);
	return shaObj.getHash("HEX");
}

if (typeof module === "object") {
  module.exports = { ListStore, Storage, hash };
  var jssha = require('jssha');
}

},{"jssha":16}],6:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
*
* Copyright (C) 2018 Giorgio Maone <giorgio@maone.net>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

"use strict";
var Test = (() => {
  const RUNNER_URL = browser.extension.getURL("/test/SpecRunner.html");
  return {
    /*
      returns RUNNER_URL if it's a test-enabled build or an about:debugging
      temporary extension session, null otherwise
    */
    async getURL() {
      let url = RUNNER_URL;
      try {
        await fetch(url);
      } catch (e) {
        url = null;
      }
      this.getURL = () => url;
      return url;
    },

    async getTab(activate = false) {
      let url = await this.getURL();
      let tab = url ? (await browser.tabs.query({url}))[0] ||
                    (await browser.tabs.create({url}))
        : null;
      if (tab && activate) {
        await browser.tabs.update(tab.id, {active: true});
      }
      return tab;
    }
  };
})();
if (typeof module === "object") {
  module.exports = Test;
}

},{}],7:[function(require,module,exports){
module.exports=module.exports = {
	fname_data : {
		"WebGLShader": true,
		"WebGLShaderPrecisionFormat": true,
		"WebGLQuery": true,
		"WebGLRenderbuffer": true,
		"WebGLSampler": true,
		"WebGLUniformLocation": true,
		"WebGLFramebuffer": true,
		"WebGLProgram": true,
		"WebGLContextEvent": true,
		"WebGL2RenderingContext": true,
		"WebGLTexture": true,
		"WebGLRenderingContext": true,
		"WebGLVertexArrayObject": true,
		"WebGLActiveInfo": true,
		"WebGLTransformFeedback": true,
		"WebGLSync": true,
		"WebGLBuffer": true,
		"cat_svg": true,
		"SVGPoint": true,
		"SVGEllipseElement": true,
		"SVGRadialGradientElement": true,
		"SVGComponentTransferFunctionElement": true,
		"SVGPathSegCurvetoQuadraticAbs": true,
		"SVGAnimatedNumberList": true,
		"SVGPathSegCurvetoQuadraticSmoothRel": true,
		"SVGFEColorMatrixElement": true,
		"SVGPathSegLinetoHorizontalAbs": true,
		"SVGLinearGradientElement": true,
		"SVGStyleElement": true,
		"SVGPathSegMovetoRel": true,
		"SVGStopElement": true,
		"SVGPathSegLinetoRel": true,
		"SVGFEConvolveMatrixElement": true,
		"SVGAnimatedAngle": true,
		"SVGPathSegLinetoAbs": true,
		"SVGPreserveAspectRatio": true,
		"SVGFEOffsetElement": true,
		"SVGFEImageElement": true,
		"SVGFEDiffuseLightingElement": true,
		"SVGAnimatedNumber": true,
		"SVGTextElement": true,
		"SVGFESpotLightElement": true,
		"SVGFEMorphologyElement": true,
		"SVGAngle": true,
		"SVGScriptElement": true,
		"SVGFEDropShadowElement": true,
		"SVGPathSegArcRel": true,
		"SVGNumber": true,
		"SVGPathSegLinetoHorizontalRel": true,
		"SVGFEFuncBElement": true,
		"SVGClipPathElement": true,
		"SVGPathSeg": true,
		"SVGUseElement": true,
		"SVGPathSegArcAbs": true,
		"SVGPathSegCurvetoQuadraticSmoothAbs": true,
		"SVGRect": true,
		"SVGAnimatedPreserveAspectRatio": true,
		"SVGImageElement": true,
		"SVGAnimatedEnumeration": true,
		"SVGAnimatedLengthList": true,
		"SVGFEFloodElement": true,
		"SVGFECompositeElement": true,
		"SVGAElement": true,
		"SVGAnimatedBoolean": true,
		"SVGMaskElement": true,
		"SVGFilterElement": true,
		"SVGPathSegLinetoVerticalRel": true,
		"SVGAnimatedInteger": true,
		"SVGTSpanElement": true,
		"SVGMarkerElement": true,
		"SVGStringList": true,
		"SVGTransform": true,
		"SVGTitleElement": true,
		"SVGFEBlendElement": true,
		"SVGTextPositioningElement": true,
		"SVGFEFuncGElement": true,
		"SVGFEPointLightElement": true,
		"SVGAnimateElement": true,
		"SVGPolylineElement": true,
		"SVGDefsElement": true,
		"SVGPathSegList": true,
		"SVGAnimatedTransformList": true,
		"SVGPathSegClosePath": true,
		"SVGGradientElement": true,
		"SVGSwitchElement": true,
		"SVGViewElement": true,
		"SVGUnitTypes": true,
		"SVGPathSegMovetoAbs": true,
		"SVGSymbolElement": true,
		"SVGFEFuncAElement": true,
		"SVGAnimatedString": true,
		"SVGFEMergeElement": true,
		"SVGPathSegLinetoVerticalAbs": true,
		"SVGAnimationElement": true,
		"SVGPathSegCurvetoCubicAbs": true,
		"SVGLength": true,
		"SVGTextPathElement": true,
		"SVGPolygonElement": true,
		"SVGAnimatedRect": true,
		"SVGPathSegCurvetoCubicRel": true,
		"SVGFEFuncRElement": true,
		"SVGLengthList": true,
		"SVGTextContentElement": true,
		"SVGFETurbulenceElement": true,
		"SVGMatrix": true,
		"SVGZoomAndPan": true,
		"SVGMetadataElement": true,
		"SVGFEDistantLightElement": true,
		"SVGAnimateMotionElement": true,
		"SVGDescElement": true,
		"SVGPathSegCurvetoCubicSmoothRel": true,
		"SVGFESpecularLightingElement": true,
		"SVGFEGaussianBlurElement": true,
		"SVGFEComponentTransferElement": true,
		"SVGNumberList": true,
		"SVGTransformList": true,
		"SVGForeignObjectElement": true,
		"SVGRectElement": true,
		"SVGFEDisplacementMapElement": true,
		"SVGAnimateTransformElement": true,
		"SVGAnimatedLength": true,
		"SVGPointList": true,
		"SVGPatternElement": true,
		"SVGPathSegCurvetoCubicSmoothAbs": true,
		"SVGCircleElement": true,
		"SVGSetElement": true,
		"SVGFETileElement": true,
		"SVGMPathElement": true,
		"SVGFEMergeNodeElement": true,
		"SVGPathSegCurvetoQuadraticRel": true,
		"SVGElement": true,
		"SVGGraphicsElement": true,
		"SVGSVGElement": true,
		"SVGGElement": true,
		"SVGGeometryElement": true,
		"SVGPathElement": true,
		"SVGLineElement": true,
		"cat_html": true,
		"HTMLTimeElement": true,
		"HTMLPictureElement": true,
		"HTMLMenuItemElement": true,
		"HTMLFormElement": true,
		"HTMLOptionElement": true,
		"HTMLCanvasElement": true,
		"HTMLTableSectionElement": true,
		"HTMLSelectElement": true,
		"HTMLUListElement": true,
		"HTMLMetaElement": true,
		"HTMLLinkElement": true,
		"HTMLBaseElement": true,
		"HTMLDataListElement": true,
		"HTMLInputElement": true,
		"HTMLMeterElement": true,
		"HTMLSourceElement": true,
		"HTMLTrackElement": true,
		"HTMLTableColElement": true,
		"HTMLFieldSetElement": true,
		"HTMLDirectoryElement": true,
		"HTMLTableCellElement": true,
		"HTMLStyleElement": true,
		"HTMLAudioElement": true,
		"HTMLLegendElement": true,
		"HTMLOListElement": true,
		"HTMLEmbedElement": true,
		"HTMLQuoteElement": true,
		"HTMLMenuElement": true,
		"HTMLHeadElement": true,
		"HTMLUnknownElement": true,
		"HTMLBRElement": true,
		"HTMLProgressElement": true,
		"HTMLMediaElement": true,
		"HTMLFormControlsCollection": true,
		"HTMLCollection": true,
		"HTMLLIElement": true,
		"HTMLDetailsElement": true,
		"HTMLObjectElement": true,
		"HTMLHeadingElement": true,
		"HTMLTableCaptionElement": true,
		"HTMLPreElement": true,
		"HTMLAllCollection": true,
		"HTMLFrameSetElement": true,
		"HTMLFontElement": true,
		"HTMLFrameElement": true,
		"HTMLAnchorElement": true,
		"HTMLOptGroupElement": true,
		"HTMLVideoElement": true,
		"HTMLModElement": true,
		"HTMLBodyElement": true,
		"HTMLTableElement": true,
		"HTMLButtonElement": true,
		"HTMLTableRowElement": true,
		"HTMLAreaElement": true,
		"HTMLDataElement": true,
		"HTMLParamElement": true,
		"HTMLLabelElement": true,
		"HTMLTemplateElement": true,
		"HTMLOptionsCollection": true,
		"HTMLIFrameElement": true,
		"HTMLTitleElement": true,
		"HTMLMapElement": true,
		"HTMLOutputElement": true,
		"HTMLDListElement": true,
		"HTMLParagraphElement": true,
		"HTMLHRElement": true,
		"HTMLImageElement": true,
		"HTMLDocument": true,
		"HTMLElement": true,
		"HTMLScriptElement": true,
		"HTMLHtmlElement": true,
		"HTMLTextAreaElement": true,
		"HTMLDivElement": true,
		"HTMLSpanElement": true,
		"cat_css": true,
		"CSSStyleRule": true,
		"CSSFontFaceRule": true,
		"CSSPrimitiveValue": true,
		"CSSStyleDeclaration": true,
		"CSSStyleSheet": true,
		"CSSPageRule": true,
		"CSSSupportsRule": true,
		"CSSMozDocumentRule": true,
		"CSSKeyframeRule": true,
		"CSSGroupingRule": true,
		"CSS2Properties": true,
		"CSSFontFeatureValuesRule": true,
		"CSSRuleList": true,
		"CSSPseudoElement": true,
		"CSSMediaRule": true,
		"CSSCounterStyleRule": true,
		"CSSImportRule": true,
		"CSSTransition": true,
		"CSSAnimation": true,
		"CSSValue": true,
		"CSSNamespaceRule": true,
		"CSSRule": true,
		"CSS": true,
		"CSSKeyframesRule": true,
		"CSSConditionRule": true,
		"CSSValueList": true,
		"cat_event": true,
		"ondevicemotion": true,
		"ondeviceorientation": true,
		"onabsolutedeviceorientation": true,
		"ondeviceproximity": true,
		"onuserproximity": true,
		"ondevicelight": true,
		"onvrdisplayconnect": true,
		"onvrdisplaydisconnect": true,
		"onvrdisplayactivate": true,
		"onvrdisplaydeactivate": true,
		"onvrdisplaypresentchange": true,
		"onabort": true,
		"onblur": true,
		"onfocus": true,
		"onauxclick": true,
		"oncanplay": true,
		"oncanplaythrough": true,
		"onchange": true,
		"onclick": true,
		"onclose": true,
		"oncontextmenu": true,
		"ondblclick": true,
		"ondrag": true,
		"ondragend": true,
		"ondragenter": true,
		"ondragexit": true,
		"ondragleave": true,
		"ondragover": true,
		"ondragstart": true,
		"ondrop": true,
		"ondurationchange": true,
		"onemptied": true,
		"onended": true,
		"oninput": true,
		"oninvalid": true,
		"onkeydown": true,
		"onkeypress": true,
		"onkeyup": true,
		"onload": true,
		"onloadeddata": true,
		"onloadedmetadata": true,
		"onloadend": true,
		"onloadstart": true,
		"onmousedown": true,
		"onmouseenter": true,
		"onmouseleave": true,
		"onmousemove": true,
		"onmouseout": true,
		"onmouseover": true,
		"onmouseup": true,
		"onwheel": true,
		"onpause": true,
		"onplay": true,
		"onplaying": true,
		"onprogress": true,
		"onratechange": true,
		"onreset": true,
		"onresize": true,
		"onscroll": true,
		"onseeked": true,
		"onseeking": true,
		"onselect": true,
		"onshow": true,
		"onstalled": true,
		"onsubmit": true,
		"onsuspend": true,
		"ontimeupdate": true,
		"onvolumechange": true,
		"onwaiting": true,
		"onselectstart": true,
		"ontoggle": true,
		"onpointercancel": true,
		"onpointerdown": true,
		"onpointerup": true,
		"onpointermove": true,
		"onpointerout": true,
		"onpointerover": true,
		"onpointerenter": true,
		"onpointerleave": true,
		"ongotpointercapture": true,
		"onlostpointercapture": true,
		"onmozfullscreenchange": true,
		"onmozfullscreenerror": true,
		"onanimationcancel": true,
		"onanimationend": true,
		"onanimationiteration": true,
		"onanimationstart": true,
		"ontransitioncancel": true,
		"ontransitionend": true,
		"ontransitionrun": true,
		"ontransitionstart": true,
		"onwebkitanimationend": true,
		"onwebkitanimationiteration": true,
		"onwebkitanimationstart": true,
		"onwebkittransitionend": true,
		"onerror": false,
		"onafterprint": true,
		"onbeforeprint": true,
		"onbeforeunload": true,
		"onhashchange": true,
		"onlanguagechange": true,
		"onmessage": true,
		"onmessageerror": true,
		"onoffline": true,
		"ononline": true,
		"onpagehide": true,
		"onpageshow": true,
		"onpopstate": true,
		"onstorage": true,
		"onunload": true,
		"cat_rtc": true,
		"RTCDTMFSender": true,
		"RTCStatsReport": true,
		"RTCTrackEvent": true,
		"RTCDataChannelEvent": true,
		"RTCPeerConnectionIceEvent": true,
		"RTCCertificate": true,
		"RTCDTMFToneChangeEvent": true,
		"RTCPeerConnection": true,
		"RTCIceCandidate": true,
		"RTCRtpReceiver": true,
		"RTCRtpSender": true,
		"RTCSessionDescription": true,
		"cat_vr": true,
		"VRStageParameters": true,
		"VRFrameData": true,
		"VRDisplay": true,
		"VRDisplayEvent": true,
		"VRFieldOfView": true,
		"VRDisplayCapabilities": true,
		"VREyeParameters": true,
		"VRPose": true,
		"cat_dom": true,
		"DOMStringMap": true,
		"DOMRectReadOnly": true,
		"DOMException": true,
		"DOMRect": true,
		"DOMMatrix": true,
		"DOMMatrixReadOnly": true,
		"DOMPointReadOnly": true,
		"DOMPoint": true,
		"DOMQuad": true,
		"DOMRequest": true,
		"DOMParser": true,
		"DOMTokenList": true,
		"DOMStringList": true,
		"DOMImplementation": true,
		"DOMError": true,
		"DOMRectList": true,
		"DOMCursor": true,
		"cat_idb": true,
		"IDBFileRequest": true,
		"IDBTransaction": true,
		"IDBCursor": true,
		"IDBFileHandle": true,
		"IDBMutableFile": true,
		"IDBKeyRange": true,
		"IDBVersionChangeEvent": true,
		"IDBObjectStore": true,
		"IDBFactory": true,
		"IDBCursorWithValue": true,
		"IDBOpenDBRequest": true,
		"IDBRequest": true,
		"IDBIndex": true,
		"IDBDatabase": true,
		"cat_audio": true,
		"AudioContext": true,
		"AudioBuffer": true,
		"AudioBufferSourceNode": true,
		"Audio": true,
		"MediaElementAudioSourceNode": true,
		"AudioNode": true,
		"BaseAudioContext": true,
		"AudioListener": true,
		"MediaStreamAudioSourceNode": true,
		"OfflineAudioContext": true,
		"AudioDestinationNode": true,
		"AudioParam": true,
		"MediaStreamAudioDestinationNode": true,
		"OfflineAudioCompletionEvent": true,
		"AudioStreamTrack": true,
		"AudioScheduledSourceNode": true,
		"AudioProcessingEvent": true,
		"cat_gamepad": true,
		"GamepadButton": true,
		"GamepadHapticActuator": true,
		"GamepadAxisMoveEvent": true,
		"GamepadPose": true,
		"GamepadEvent": true,
		"Gamepad": true,
		"GamepadButtonEvent": true,
		"cat_media": true,
		"MediaKeys": true,
		"MediaKeyError": true,
		"MediaSource": true,
		"MediaDevices": true,
		"MediaKeyStatusMap": true,
		"MediaStreamTrackEvent": true,
		"MediaRecorder": true,
		"MediaQueryListEvent": true,
		"MediaStream": true,
		"MediaEncryptedEvent": true,
		"MediaStreamTrack": true,
		"MediaError": true,
		"MediaStreamEvent": true,
		"MediaQueryList": true,
		"MediaKeySystemAccess": true,
		"MediaDeviceInfo": true,
		"MediaKeySession": true,
		"MediaList": true,
		"MediaRecorderErrorEvent": true,
		"MediaKeyMessageEvent": true,
		"cat_event2": true,
		"SpeechSynthesisErrorEvent": true,
		"BeforeUnloadEvent": true,
		"CustomEvent": true,
		"PageTransitionEvent": true,
		"PopupBlockedEvent": true,
		"CloseEvent": true,
		"ProgressEvent": true,
		"MutationEvent": true,
		"MessageEvent": true,
		"FocusEvent": true,
		"TrackEvent": true,
		"DeviceMotionEvent": true,
		"TimeEvent": true,
		"PointerEvent": true,
		"UserProximityEvent": true,
		"StorageEvent": true,
		"DragEvent": true,
		"MouseScrollEvent": true,
		"EventSource": true,
		"PopStateEvent": true,
		"DeviceProximityEvent": true,
		"SpeechSynthesisEvent": true,
		"XMLHttpRequestEventTarget": true,
		"ClipboardEvent": true,
		"AnimationPlaybackEvent": true,
		"DeviceLightEvent": true,
		"BlobEvent": true,
		"MouseEvent": true,
		"WheelEvent": true,
		"InputEvent": true,
		"HashChangeEvent": true,
		"DeviceOrientationEvent": true,
		"CompositionEvent": true,
		"KeyEvent": true,
		"ScrollAreaEvent": true,
		"KeyboardEvent": true,
		"TransitionEvent": true,
		"ErrorEvent": true,
		"AnimationEvent": true,
		"FontFaceSetLoadEvent": true,
		"EventTarget": true,
		"captureEvents": true,
		"releaseEvents": true,
		"Event": true,
		"UIEvent": true,
		"cat_other": false,
		"undefined": false,
		"Array": false,
		"Boolean": false,
		"JSON": false,
		"Date": false,
		"Math": false,
		"Number": false,
		"String": false,
		"RegExp": false,
		"Error": false,
		"InternalError": false,
		"EvalError": false,
		"RangeError": false,
		"ReferenceError": false,
		"SyntaxError": false,
		"TypeError": false,
		"URIError": false,
		"ArrayBuffer": true,
		"Int8Array": true,
		"Uint8Array": true,
		"Int16Array": true,
		"Uint16Array": true,
		"Int32Array": true,
		"Uint32Array": true,
		"Float32Array": true,
		"Float64Array": true,
		"Uint8ClampedArray": true,
		"Proxy": true,
		"WeakMap": true,
		"Map": true,
		"Set": true,
		"DataView": false,
		"Symbol": false,
		"SharedArrayBuffer": true,
		"Intl": false,
		"TypedObject": true,
		"Reflect": true,
		"SIMD": true,
		"WeakSet": true,
		"Atomics": true,
		"Promise": true,
		"WebAssembly": true,
		"NaN": false,
		"Infinity": false,
		"isNaN": false,
		"isFinite": false,
		"parseFloat": false,
		"parseInt": false,
		"escape": false,
		"unescape": false,
		"decodeURI": false,
		"encodeURI": false,
		"decodeURIComponent": false,
		"encodeURIComponent": false,
		"uneval": false,
		"BatteryManager": true,
		"CanvasGradient": true,
		"TextDecoder": true,
		"Plugin": true,
		"PushManager": true,
		"ChannelMergerNode": true,
		"PerformanceResourceTiming": true,
		"ServiceWorker": true,
		"TextTrackCueList": true,
		"PerformanceEntry": true,
		"TextTrackList": true,
		"StyleSheet": true,
		"PerformanceMeasure": true,
		"DesktopNotificationCenter": true,
		"Comment": true,
		"DelayNode": true,
		"XPathResult": true,
		"CDATASection": true,
		"MessageChannel": true,
		"BiquadFilterNode": true,
		"SpeechSynthesisUtterance": true,
		"Crypto": true,
		"Navigator": true,
		"FileList": true,
		"URLSearchParams": false,
		"ServiceWorkerContainer": true,
		"ValidityState": true,
		"ProcessingInstruction": true,
		"AbortSignal": true,
		"FontFace": true,
		"FileReader": true,
		"Worker": true,
		"External": true,
		"ImageBitmap": true,
		"TimeRanges": true,
		"Option": true,
		"TextTrack": true,
		"Image": true,
		"AnimationTimeline": true,
		"VideoPlaybackQuality": true,
		"VTTCue": true,
		"Storage": true,
		"XPathExpression": true,
		"CharacterData": false,
		"TextMetrics": true,
		"AnimationEffectReadOnly": true,
		"PerformanceTiming": false,
		"PerformanceMark": true,
		"ImageBitmapRenderingContext": true,
		"Headers": true,
		"Range": false,
		"Rect": true,
		"AnimationEffectTimingReadOnly": true,
		"KeyframeEffect": true,
		"Permissions": true,
		"TextEncoder": true,
		"ImageData": true,
		"SpeechSynthesisVoice": true,
		"StorageManager": true,
		"TextTrackCue": true,
		"WebSocket": true,
		"DocumentType": true,
		"XPathEvaluator": true,
		"PerformanceNavigationTiming": true,
		"IdleDeadline": true,
		"FileSystem": true,
		"FileSystemFileEntry": true,
		"CacheStorage": true,
		"MimeType": true,
		"PannerNode": true,
		"NodeFilter": true,
		"StereoPannerNode": true,
		"console": false,
		"DynamicsCompressorNode": true,
		"PaintRequest": true,
		"RGBColor": true,
		"FontFaceSet": false,
		"PaintRequestList": true,
		"FileSystemEntry": true,
		"XMLDocument": false,
		"SourceBuffer": false,
		"Screen": true,
		"NamedNodeMap": false,
		"History": true,
		"Response": true,
		"AnimationEffectTiming": true,
		"ServiceWorkerRegistration": true,
		"CanvasRenderingContext2D": true,
		"ScriptProcessorNode": true,
		"FileSystemDirectoryReader": true,
		"MimeTypeArray": true,
		"CanvasCaptureMediaStream": true,
		"Directory": true,
		"mozRTCPeerConnection": true,
		"PerformanceObserverEntryList": true,
		"PushSubscriptionOptions": true,
		"Text": false,
		"IntersectionObserverEntry": true,
		"SubtleCrypto": true,
		"Animation": true,
		"DataTransfer": true,
		"TreeWalker": true,
		"XMLHttpRequest": true,
		"LocalMediaStream": true,
		"ConvolverNode": true,
		"WaveShaperNode": true,
		"DataTransferItemList": false,
		"Request": true,
		"SourceBufferList": false,
		"XSLTProcessor": true,
		"XMLHttpRequestUpload": true,
		"SharedWorker": true,
		"Notification": false,
		"DataTransferItem": true,
		"AnalyserNode": true,
		"mozRTCIceCandidate": true,
		"PerformanceObserver": true,
		"OfflineResourceList": true,
		"FileSystemDirectoryEntry": true,
		"DesktopNotification": false,
		"DataChannel": true,
		"IIRFilterNode": true,
		"ChannelSplitterNode": true,
		"File": true,
		"ConstantSourceNode": true,
		"CryptoKey": true,
		"GainNode": true,
		"AbortController": true,
		"Attr": true,
		"SpeechSynthesis": true,
		"PushSubscription": false,
		"XMLStylesheetProcessingInstruction": false,
		"NodeIterator": true,
		"VideoStreamTrack": true,
		"XMLSerializer": true,
		"CaretPosition": true,
		"FormData": true,
		"CanvasPattern": true,
		"mozRTCSessionDescription": true,
		"Path2D": true,
		"PerformanceNavigation": true,
		"URL": false,
		"PluginArray": true,
		"MutationRecord": true,
		"WebKitCSSMatrix": true,
		"PeriodicWave": true,
		"DocumentFragment": true,
		"DocumentTimeline": false,
		"ScreenOrientation": true,
		"BroadcastChannel": true,
		"PermissionStatus": true,
		"IntersectionObserver": true,
		"Blob": true,
		"MessagePort": true,
		"BarProp": true,
		"OscillatorNode": true,
		"Cache": true,
		"RadioNodeList": true,
		"KeyframeEffectReadOnly": true,
		"InstallTrigger": true,
		"Function": false,
		"Object": false,
		"eval": true,
		"Window": false,
		"close": false,
		"stop": false,
		"focus": false,
		"blur": false,
		"open": true,
		"alert": false,
		"confirm": false,
		"prompt": false,
		"print": false,
		"postMessage": true,
		"getSelection": true,
		"getComputedStyle": true,
		"matchMedia": true,
		"moveTo": false,
		"moveBy": false,
		"resizeTo": false,
		"resizeBy": false,
		"scroll": false,
		"scrollTo": false,
		"scrollBy": false,
		"requestAnimationFrame": true,
		"cancelAnimationFrame": true,
		"getDefaultComputedStyle": false,
		"scrollByLines": false,
		"scrollByPages": false,
		"sizeToContent": false,
		"updateCommands": true,
		"find": false,
		"dump": true,
		"setResizable": false,
		"requestIdleCallback": false,
		"cancelIdleCallback": false,
		"btoa": true,
		"atob": true,
		"setTimeout": true,
		"clearTimeout": true,
		"setInterval": true,
		"clearInterval": true,
		"createImageBitmap": true,
		"fetch": true,
		"self": true,
		"name": false,
		"history": true,
		"locationbar": true,
		"menubar": true,
		"personalbar": true,
		"scrollbars": true,
		"statusbar": true,
		"toolbar": true,
		"status": true,
		"closed": true,
		"frames": true,
		"length": false,
		"opener": true,
		"parent": true,
		"frameElement": true,
		"navigator": true,
		"external": true,
		"applicationCache": true,
		"screen": true,
		"innerWidth": true,
		"innerHeight": true,
		"scrollX": true,
		"pageXOffset": true,
		"scrollY": true,
		"pageYOffset": true,
		"screenX": true,
		"screenY": true,
		"outerWidth": true,
		"outerHeight": true,
		"performance": true,
		"mozInnerScreenX": true,
		"mozInnerScreenY": true,
		"devicePixelRatio": true,
		"scrollMaxX": true,
		"scrollMaxY": true,
		"fullScreen": false,
		"mozPaintCount": true,
		"sidebar": false,
		"crypto": true,
		"speechSynthesis": true,
		"localStorage": true,
		"origin": true,
		"isSecureContext": false,
		"indexedDB": true,
		"caches": true,
		"sessionStorage": true,
		"window": false,
		"document": true,
		"location": false,
		"top": false,
		"netscape": true,
		"Node": true,
		"Document": true,
		"Performance": false,
		"startProfiling": true,
		"stopProfiling": true,
		"pauseProfilers": true,
		"resumeProfilers": true,
		"dumpProfile": true,
		"getMaxGCPauseSinceClear": true,
		"clearMaxGCPauseAccumulator": true,
		"Location": true,
		"StyleSheetList": false,
		"Selection": false,
		"Element": true,
		"AnonymousContent": false,
		"MutationObserver": true,
		"NodeList": true,
		"StopIteration": true
	}
};

},{}],8:[function(require,module,exports){
module.exports = {
	whitelist: {"jquery":[{"filename":"core.js","version":"3.3.1","hash":"6026ca247eaee2c88fa54964d77d2e76efc97a974a5695e3744cb38defb3d691"},{"filename":"jquery.js","version":"3.3.1","hash":"d8aa24ecc6cecb1a60515bc093f1c9da38a0392612d9ab8ae0f7f36e6eee1fad"},{"filename":"jquery.min.js","version":"3.3.1","hash":"160a426ff2894252cd7cebbdd6d6b7da8fcd319c65b70468f10b6690c45d02ef"},{"filename":"jquery.slim.js","version":"3.3.1","hash":"7cd5c914895c6b4e4120ed98e73875c6b4a12b7304fbf9586748fe0a1c57d830"},{"filename":"jquery.slim.min.js","version":"3.3.1","hash":"dde76b9b2b90d30eb97fc81f06caa8c338c97b688cea7d2729c88f529f32fbb1"},{"filename":"core.js","version":"3.3.0","hash":"58db1cc9582b20320c552043b5880b40c8eaec3e6d4b46994222862a049330a1"},{"filename":"jquery.js","version":"3.3.0","hash":"4c5592b8326dea44be86e57ebd59725758ccdddc0675e356a9ece14f15c1fd7f"},{"filename":"jquery.min.js","version":"3.3.0","hash":"453432f153a63654fa6f63c846eaf7ee9e8910165413ba3cc0f80cbeed7c302e"},{"filename":"jquery.slim.js","version":"3.3.0","hash":"ec89a3d1f2cab57e4d144092d6e9a8429ecd0b594482be270536ac366ee004b6"},{"filename":"jquery.slim.min.js","version":"3.3.0","hash":"00c83723bc9aefa38b3c3f4cf8c93b92aac0dbd1d49ff16e1817d3ffd51ff65b"},{"filename":"core.js","version":"3.2.1","hash":"052b1b5ec0c4ae78aafc7a6e8542c5a2bf31d42a40dac3cfc102e512812b8bed"},{"filename":"jquery.js","version":"3.2.1","hash":"0d9027289ffa5d9f6c8b4e0782bb31bbff2cef5ee3708ccbcb7a22df9128bb21"},{"filename":"jquery.min.js","version":"3.2.1","hash":"87083882cc6015984eb0411a99d3981817f5dc5c90ba24f0940420c5548d82de"},{"filename":"jquery.slim.js","version":"3.2.1","hash":"b40f32d17aa2c27a7098e225dd218070597646fc478c0f2aa74fb5b821a64668"},{"filename":"jquery.slim.min.js","version":"3.2.1","hash":"9365920887b11b33a3dc4ba28a0f93951f200341263e3b9cefd384798e4be398"},{"filename":"core.js","version":"3.2.0","hash":"7c5c8f96ac182ed4d2c9ac74fda37941745f2793814fbd8b28624a9a720f9d39"},{"filename":"jquery.js","version":"3.2.0","hash":"c0f149348165558e3d07e0ae008ac3afddf65d26fa264dc9d4cdb6337136ca54"},{"filename":"jquery.min.js","version":"3.2.0","hash":"2405bdf4c255a4904671bcc4b97938033d39b3f5f20dd068985a8d94cde273e2"},{"filename":"jquery.slim.js","version":"3.2.0","hash":"f18ac10930e84233b80814f5595bcc1f6ffad74047d038d997114e08880aec03"},{"filename":"jquery.slim.min.js","version":"3.2.0","hash":"a8b02fd240408a170764b2377efdd621329e46c517dbb85deaea4105ad0c4a8c"},{"filename":"core.js","version":"3.1.1","hash":"4a4dec7ca8f2567b4327c82b873c8d7dd774f74b9009d2ff65431a8154693dea"},{"filename":"jquery.js","version":"3.1.1","hash":"d7a71d3dd740e95755227ba6446a3a21b8af6c4444f29ec2411dc7cd306e10b0"},{"filename":"jquery.min.js","version":"3.1.1","hash":"85556761a8800d14ced8fcd41a6b8b26bf012d44a318866c0d81a62092efd9bf"},{"filename":"jquery.slim.js","version":"3.1.1","hash":"e62fe6437d3433befd3763950eb975ea56e88705cd51dccbfd1d9a5545f25d60"},{"filename":"jquery.slim.min.js","version":"3.1.1","hash":"fd222b36abfc87a406283b8da0b180e22adeb7e9327ac0a41c6cd5514574b217"},{"filename":"core.js","version":"3.1.0","hash":"55994528e7efe901e92a76761a54ba0c3ae3f1f8d1c3a4da9a23a3e4a06d0eaa"},{"filename":"jquery.js","version":"3.1.0","hash":"b25a2092f0752b754e933008f10213c55dd5ce93a791e355b0abed9182cc8df9"},{"filename":"jquery.min.js","version":"3.1.0","hash":"702b9e051e82b32038ffdb33a4f7eb5f7b38f4cf6f514e4182d8898f4eb0b7fb"},{"filename":"jquery.slim.js","version":"3.1.0","hash":"2faa690232fa8e0b5199f8ae8a0784139030348da91ff5fd2016cfc9a9c9799c"},{"filename":"jquery.slim.min.js","version":"3.1.0","hash":"711a568e848ec3929cc8839a64da388ba7d9f6d28f85861bea2e53f51495246f"},{"filename":"core.js","version":"3.0.0-rc1","hash":"11853583eb5ce8ab1aacc380430145de705cdfff0e72c54d3dca17d01466999b"},{"filename":"jquery.js","version":"3.0.0-rc1","hash":"65ded5fa34aa91b976dae0af5888ce4c06fed34271f3665b2924505b704025c7"},{"filename":"jquery.min.js","version":"3.0.0-rc1","hash":"df68e90250b9a60fc184ef194d1769d3af8aa67396cc064281cb77e2ef6bf876"},{"filename":"jquery.slim.js","version":"3.0.0-rc1","hash":"c96eeff335114aa55df0328bbe5f9202ed7a3266b6e81fcd357cd17837fa9756"},{"filename":"jquery.slim.min.js","version":"3.0.0-rc1","hash":"e92bbd6e77604b75e910952f20f3c95ce29050c7b1137dc1edddad000c236b5d"},{"filename":"jquery.js","version":"3.0.0-beta1","hash":"78f27c3d7cb5d766466703adc7f7ad7706b7fb05514eec39be0aa253449bd0f8"},{"filename":"jquery.min.js","version":"3.0.0-beta1","hash":"b72a0aa436a8a8965041beda30577232677ef6588bb933b5bebed2de02c04dc8"},{"filename":"jquery.slim.js","version":"3.0.0-beta1","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"3.0.0-beta1","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"3.0.0-alpha1","hash":"10b3ccff4cf14cdb5e7c31b2d323be750a13125cea8ded9ca5c1da4150a69238"},{"filename":"jquery.min.js","version":"3.0.0-alpha1","hash":"19e065eaadf26f58c0e1081a2e0e64450eec2983eebb08f998ecaacac8642a47"},{"filename":"core.js","version":"3.0.0","hash":"bad41b5e9f7c6b952b3a840b84ce2e97e3029bd2b2773c58a69a33e73217d1e4"},{"filename":"jquery.js","version":"3.0.0","hash":"8eb3cb67ef2f0f1b76167135cef6570a409c79b23f0bc0ede71c9a4018f1408a"},{"filename":"jquery.min.js","version":"3.0.0","hash":"266bcea0bb58b26aa5b16c5aee60d22ccc1ae9d67daeb21db6bad56119c3447d"},{"filename":"jquery.slim.js","version":"3.0.0","hash":"1a9ea1a741fe03b6b1835b44ac2b9c59e39cdfc8abb64556a546c16528fc2828"},{"filename":"jquery.slim.min.js","version":"3.0.0","hash":"45fe0169d7f20adb2f1e63bcf4151971b62f34dbd9bce4f4f002df133bc2b03d"},{"filename":"jquery.js","version":"2.2.4","hash":"893e90f6230962e42231635df650f20544ad22affc3ee396df768eaa6bc5a6a2"},{"filename":"jquery.min.js","version":"2.2.4","hash":"05b85d96f41fff14d8f608dad03ab71e2c1017c2da0914d7c59291bad7a54f8e"},{"filename":"jquery.js","version":"2.2.3","hash":"95a5d6b46c9da70a89f0903e5fdc769a2c266a22a19fcb5598e5448a044db4fe"},{"filename":"jquery.min.js","version":"2.2.3","hash":"6b6de0d4db7876d1183a3edb47ebd3bbbf93f153f5de1ba6645049348628109a"},{"filename":"jquery.slim.js","version":"2.2.3","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"2.2.3","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"2.2.2","hash":"e3fcd40aa8aad24ab1859232a781b41a4f803ad089b18d53034d24e4296c6581"},{"filename":"jquery.min.js","version":"2.2.2","hash":"dfa729d82a3effadab1000181cb99108f232721e3b0af74cfae4c12704b35a32"},{"filename":"jquery.slim.js","version":"2.2.2","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"2.2.2","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"2.2.1","hash":"78d714ccede3b2fd179492ef7851246c1f1b03bfc2ae83693559375e99a7c077"},{"filename":"jquery.min.js","version":"2.2.1","hash":"82f420005cd31fab6b4ab016a07d623e8f5773de90c526777de5ba91e9be3b4d"},{"filename":"jquery.slim.js","version":"2.2.1","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"2.2.1","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"2.2.0","hash":"a18aa92dea997bd71eb540d5f931620591e9dee27e5f817978bb385bab924d21"},{"filename":"jquery.min.js","version":"2.2.0","hash":"8a102873a33f24f7eb22221e6b23c4f718e29f85168ecc769a35bfaed9b12cce"},{"filename":"jquery.js","version":"2.1.4","hash":"b2215cce5830e2350b9d420271d9bd82340f664c3f60f0ea850f7e9c0392704e"},{"filename":"jquery.min.js","version":"2.1.4","hash":"22642f202577f0ba2f22cbe56b6cf291a09374487567cd3563e0d2a29f75c0c5"},{"filename":"jquery.js","version":"2.1.3","hash":"828cbbcacb430f9c5b5d27fe9302f8795eb338f2421010f5141882125226f94f"},{"filename":"jquery.min.js","version":"2.1.3","hash":"2051d61446d4dbffb03727031022a08c84528ab44d203a7669c101e5fbdd5515"},{"filename":"jquery.js","version":"2.1.2","hash":"07cb07bdfba40ceff869b329eb48eeede41740ba6ce833dd3830bd0af49e4898"},{"filename":"jquery.min.js","version":"2.1.2","hash":"64c51d974a342e9df3ed548082a4ad7816d407b8c36b67356dde9e487b819cbe"},{"filename":"jquery.js","version":"2.1.1-rc2","hash":"dc0083a233768ed8554d770d9d4eed91c0e27de031b3d9cbdcecabc034265010"},{"filename":"jquery.min.js","version":"2.1.1-rc2","hash":"293c9966a4fea0fed0adc1aae242bb37e428e649337dcab65d9af5934a7cc775"},{"filename":"jquery.js","version":"2.1.1-rc1","hash":"5adbbda8312291291162ab054df8927291426dbfb550099945ece85b49707290"},{"filename":"jquery.min.js","version":"2.1.1-rc1","hash":"d246298c351558d4847d237bb2d052f22001ca24ea4a32c28de378c95af523c8"},{"filename":"jquery.js","version":"2.1.1-beta1","hash":"e96b9e8d7a12b381d2ed1efd785faef3c7bad0ea03edf42fb15c9fde533e761f"},{"filename":"jquery.min.js","version":"2.1.1-beta1","hash":"5aed44447956d7933861d56003dbd0f95504d79e19d094edacbe4a55e6cf8736"},{"filename":"jquery.js","version":"2.1.1","hash":"140ff438eaaede046f1ceba27579d16dc980595709391873fa9bf74d7dbe53ac"},{"filename":"jquery.min.js","version":"2.1.1","hash":"c0d4098bc8b34c6f87a3d7723988ae81214a53a0bb4a1d4d36a67640f98ed079"},{"filename":"jquery.js","version":"2.1.0-rc1","hash":"88d96de8ccf65e57a3f28134616e3abfe0af2b3712302beb0a73f77f6b873fd0"},{"filename":"jquery.min.js","version":"2.1.0-rc1","hash":"11f94218bacdd4dbdc5c1736ca7aa1f27bb9632bc0a1696175b408da8dcf16b3"},{"filename":"jquery.js","version":"2.1.0-beta3","hash":"8eb83f00967dd0e18877b71349f5a3641b1046a1667c54e602a5682ac0f07ab9"},{"filename":"jquery.min.js","version":"2.1.0-beta3","hash":"7ebd0c0a5a088da45a5ec48f4379dbe457129f2cbe434f2e045ef838136746a9"},{"filename":"jquery.js","version":"2.1.0-beta2","hash":"97efd5af482f4e74c37c04970421fdbd17388fd605d992a2aa0077d388b32b6d"},{"filename":"jquery.min.js","version":"2.1.0-beta2","hash":"22966516a31e64225df5e08e35f0fadb27d29a8fb2618ddca17ec171215fc323"},{"filename":"jquery.js","version":"2.1.0","hash":"0fa7752926a95e3ab6b5f67a21ef40628ce4447c81ddf4f6cacf663b6fb85af7"},{"filename":"jquery.min.js","version":"2.1.0","hash":"f284353a7cc4d97f6fe20a5155131bd43587a0f1c98a56eeaf52cff72910f47d"},{"filename":"jquery.js","version":"2.0.3","hash":"9427fe2df51f7d4c6bf35f96d19169714d0b432b99dc18f41760d0342c538122"},{"filename":"jquery.min.js","version":"2.0.3","hash":"a57b5242b9a9adc4c1ef846c365147b89c472b9cd770face331efcb965346b25"},{"filename":"jquery.js","version":"2.0.2","hash":"d2ed0720108a75db0d53248ba8e36332658064c4189714d16c0f117efb42016d"},{"filename":"jquery.min.js","version":"2.0.2","hash":"9d7d1c727e1cd32745764098a76e5d3d5fb7acd3b6527c5aacd85b7c6f8ce341"},{"filename":"jquery.js","version":"2.0.1","hash":"820fb338fe8c7478a1b820e2708b4fd306a68825de1194803e7a93fbc2177a16"},{"filename":"jquery.min.js","version":"2.0.1","hash":"4e1354fc542b617c58cbba3aeb5116a528cf08bb1299f5dc7f3bc77a3b902b68"},{"filename":"jquery.js","version":"2.0.0","hash":"896e379d334cf0b16c78d9962a1579147156d4a72355032fce0de5f673d4e287"},{"filename":"jquery.min.js","version":"2.0.0","hash":"d482871a5e948cb4884fa0972ea98a81abca057b6bd3f8c995a18c12487e761c"},{"filename":"jquery.js","version":"1.12.4","hash":"430f36f9b5f21aae8cc9dca6a81c4d3d84da5175eaedcf2fdc2c226302cb3575"},{"filename":"jquery.min.js","version":"1.12.4","hash":"668b046d12db350ccba6728890476b3efee53b2f42dbb84743e5e9f1ae0cc404"},{"filename":"jquery.js","version":"1.12.3","hash":"d5732912d03878a5cd3695dc275a6630fb3c255fa7c0b744ab08897824049327"},{"filename":"jquery.min.js","version":"1.12.3","hash":"69a3831c082fc105b56c53865cc797fa90b83d920fb2f9f6875b00ad83a18174"},{"filename":"jquery.slim.js","version":"1.12.3","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"1.12.3","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"1.12.2","hash":"5540b2af46570795610626e8d8391356176ca639b1520c4319a2d0c7ba9bef16"},{"filename":"jquery.min.js","version":"1.12.2","hash":"95914789b5f3307a3718679e867d61b9d4c03f749cd2e2970570331d7d6c8ed9"},{"filename":"jquery.slim.js","version":"1.12.2","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"1.12.2","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"1.12.1","hash":"56e843a66b2bf7188ac2f4c81df61608843ce144bd5aa66c2df4783fba85e8ef"},{"filename":"jquery.min.js","version":"1.12.1","hash":"2359d383bf2d4ab65ebf7923bdf74ce40e4093f6e58251b395a64034b3c39772"},{"filename":"jquery.slim.js","version":"1.12.1","hash":"4db510700e5773fc7065f36363affd4885c9d9ef257fd7757744f91ac9da5671"},{"filename":"jquery.slim.min.js","version":"1.12.1","hash":"4c369c555423651822c2f7772d5e0b9a56a2372a92657bd2a696fe539b24be9e"},{"filename":"jquery.js","version":"1.12.0","hash":"c85537acad72f0d7d409dfc1e2d2daa59032f71d29642a8b64b9852f70166fbb"},{"filename":"jquery.min.js","version":"1.12.0","hash":"5f1ab65fe2ad6b381a1ae036716475bf78c9b2e309528cf22170c1ddeefddcbf"},{"filename":"jquery.js","version":"1.11.3","hash":"2065aecca0fb9b0567358d352ed5f1ab72fce139bf449b4d09805f5d9c3725ed"},{"filename":"jquery.min.js","version":"1.11.3","hash":"aec3d419d50f05781a96f223e18289aeb52598b5db39be82a7b71dc67d6a7947"},{"filename":"jquery.js","version":"1.11.2","hash":"58c27035b7a2e589df397e5d7e05424b90b8c1aaaf73eff47d5ed6daecb70f25"},{"filename":"jquery.min.js","version":"1.11.2","hash":"d4ec583c7604001f87233d1fe0076cbd909f15a5f8c6b4c3f5dd81b462d79d32"},{"filename":"jquery.js","version":"1.11.1-rc2","hash":"648dbce0f3731ebce091c283b52f60b100d73807501eea1a99f7b23140bfcefa"},{"filename":"jquery.min.js","version":"1.11.1-rc2","hash":"06d766022172da3774651a3ccfeef893185f9ba46823bcbfcba744ab5e25a4bf"},{"filename":"jquery.js","version":"1.11.1-rc1","hash":"8241d4982de8a6fea3e0ebc47e99445337675a777054c09221f670adb3748995"},{"filename":"jquery.min.js","version":"1.11.1-rc1","hash":"a581c274adebdbc44022e45d9febf0b92c572481c58bfe562b3d74d5e8972c5a"},{"filename":"jquery.js","version":"1.11.1-beta1","hash":"0aab28e2fd1f61b6282132553325bd890fef40989b698311c5b00b7b38a1e19d"},{"filename":"jquery.min.js","version":"1.11.1-beta1","hash":"99ec4d1ab56cf49ee4c202cc41509ada5eeb334694815f75675792433828a527"},{"filename":"jquery.js","version":"1.11.1","hash":"3029834a820c79c154c377f52e2719fc3ff2a27600a07ae089ea7fde9087f6bc"},{"filename":"jquery.min.js","version":"1.11.1","hash":"540bc6dec1dd4b92ea4d3fb903f69eabf6d919afd48f4e312b163c28cff0f441"},{"filename":"jquery.js","version":"1.11.0-rc1","hash":"84792d2b1ab8a2d57dcc113abb910b4c31dda357a7acd3b46ed282dd03f15d25"},{"filename":"jquery.min.js","version":"1.11.0-rc1","hash":"5f58804382f5258bb6b187c1b5af1ec0b8ccbe2c904a5163580371352ca63424"},{"filename":"jquery.js","version":"1.11.0-beta3","hash":"847a61382a55d0c0e5244d0621f1e0674292dee6b850640c669fd1516ec9f4f5"},{"filename":"jquery.min.js","version":"1.11.0-beta3","hash":"51fc79c1828a885f3776e35d56a22895e3656d014b502b869bd05f891bd91602"},{"filename":"jquery.js","version":"1.11.0","hash":"ce0343e1d6f489768eeefe022c12181c6a0822e756239851310acf076d23d10c"},{"filename":"jquery.min.js","version":"1.11.0","hash":"b294e973896f8f874e90a8eb1a8908ac790980d034c4c4bdf0fc3d37b8abf682"},{"filename":"jquery.js","version":"1.10.2","hash":"8ade6740a1d3cfedf81e28d9250929341207b23a55f1be90ccc26cf6d98e052a"},{"filename":"jquery.min.js","version":"1.10.2","hash":"89a15e9c40bc6b14809f236ee8cd3ed1ea42393c1f6ca55c7855cd779b3f922e"},{"filename":"jquery.js","version":"1.10.1","hash":"ebaded49db62a60060caa2577f2a4ec1ff68726bc40861bc65d977abeb64fa7d"},{"filename":"jquery.min.js","version":"1.10.1","hash":"8bf150f6b29d6c9337de6c945a8f63c929b203442040688878bc2753fe13e007"},{"filename":"jquery.js","version":"1.10.0","hash":"8aa0f84b5331efcc3cb72c7d504c2bc6ebd861da003d72c33df99ce650d4531d"},{"filename":"jquery.min.js","version":"1.10.0","hash":"1e80de36726582824df3f9a7eb6ecdfe9827fc5a7c69f597b1502ebc13950ecd"},{"filename":"jquery.js","version":"1.9.1","hash":"7bd80d06c01c0340c1b9159b9b4a197db882ca18cbac8e9b9aa025e68f998d40"},{"filename":"jquery.min.js","version":"1.9.1","hash":"c12f6098e641aaca96c60215800f18f5671039aecf812217fab3c0d152f6adb4"},{"filename":"jquery.js","version":"1.9.0","hash":"4d7b01c2f6043bcee83a33d0f627dc6fbc27dc8aeb5bdd5d863e84304b512ef3"},{"filename":"jquery.min.js","version":"1.9.0","hash":"7fa0d5c3f538c76f878e012ac390597faecaabfe6fb9d459b919258e76c5df8e"},{"filename":"jquery.js","version":"1.8.3","hash":"756d7dfac4a35bb57543f677283d6c682e8d704e5350884b27325badd2b3c4a7"},{"filename":"jquery.min.js","version":"1.8.3","hash":"61c6caebd23921741fb5ffe6603f16634fca9840c2bf56ac8201e9264d6daccf"},{"filename":"jquery.js","version":"1.8.2","hash":"ba8f203a9ebbe5771f49bcbe0804079240c7225f4be6ab424769bfbfb35ebc35"},{"filename":"jquery.min.js","version":"1.8.2","hash":"f23d4b309b72743aa8afe1f8c98a25b3ee31246fa572c66d9d8cb1982cae4fbc"},{"filename":"jquery.js","version":"1.8.1","hash":"7614fc75c4fcf6f32f7307f37550440e12adefb9289226acb79020c66faeffea"},{"filename":"jquery.min.js","version":"1.8.1","hash":"a1305347219d673cc973172494248e557ce8eccaf65af995c07c9d7daed4475d"},{"filename":"jquery-1.8.0.js","version":"1.8.0","hash":"04ee795a1a5a908ee339e145ae6c6b394d1dc0d971fd0896e3cb776660adba2e"},{"filename":"jquery-1.8.0.min.js","version":"1.8.0","hash":"d73e2e1bff9c55b85284ff287cb20dc29ad9165ec09091a0597b61199f330805"},{"filename":"jquery.js","version":"1.8.0","hash":"04ee795a1a5a908ee339e145ae6c6b394d1dc0d971fd0896e3cb776660adba2e"},{"filename":"jquery.min.js","version":"1.8.0","hash":"d73e2e1bff9c55b85284ff287cb20dc29ad9165ec09091a0597b61199f330805"},{"filename":"jquery.min.js","version":"1.7.2","hash":"47b68dce8cb6805ad5b3ea4d27af92a241f4e29a5c12a274c852e4346a0500b4"},{"filename":"jquery.min.js","version":"1.7.1","hash":"88171413fc76dda23ab32baa17b11e4fff89141c633ece737852445f1ba6c1bd"},{"filename":"jquery.min.js","version":"1.7","hash":"ff4e4975ef403004f8fe8e59008db7ad47f54b10d84c72eb90e728d1ec9157ce"},{"filename":"jquery.js","version":"1.6.4","hash":"54964f8b580ad795a962fb27066715d3281ae1ad13a28bf8aedd5d8859ebae37"},{"filename":"jquery.min.js","version":"1.6.4","hash":"951d6bae39eb172f57a88bd686f7a921cf060fd21f59648f0d20b6a8f98fc5a5"},{"filename":"jquery.js","version":"1.6.3","hash":"9baa10e1c5630c3dcd9bb46bf00913cc94b3855d58c9459ae9848339c566e97b"},{"filename":"jquery.min.js","version":"1.6.3","hash":"d3f3779f5113da6da957c4d81481146a272c31aefe0d3e4b64414fd686fd9744"},{"filename":"jquery.js","version":"1.6.2","hash":"a57292619d14eb8cbd923bde9f28cf994ac66abc48f7c975b769328ff33bddc9"},{"filename":"jquery.min.js","version":"1.6.2","hash":"fefb084f14120d777c7857ba78603e8531a0778b2e639df7622513c70567afa0"},{"filename":"jquery.js","version":"1.6.1","hash":"0eef76a9583a6c7a1eb764d33fe376bfe1861df79fab82c2c3f5d16183e82016"},{"filename":"jquery.min.js","version":"1.6.1","hash":"c784376960f3163dc760bc019e72e5fed78203745a5510c69992a39d1d8fe776"},{"filename":"jquery.js","version":"1.5.1","hash":"e2ea0a6ca6b984a9405a759d24cf3c51eb3164e5c43e95c3e9a59b316be7b3b9"},{"filename":"jquery.min.js","version":"1.5.1","hash":"764b9e9f3ad386aaa5cdeae9368353994de61c0bede087c8f7e3579cb443de3b"},{"filename":"jquery.js","version":"1.4.4","hash":"b31cd094af7950b3a461dc78161fd2faf01faa9d0ed8c1c072790f83ab26d482"},{"filename":"jquery.min.js","version":"1.4.4","hash":"517364f2d45162fb5037437b5b6cb953d00d9b2b3b79ba87d9fe57ea6ee6070c"},{"filename":"jquery.js","version":"1.4.3","hash":"0e3303a3a0cec95ebc8c3cc3e19fc71c99487faa286b05d01a3eb8cca4d90bc7"},{"filename":"jquery.min.js","version":"1.4.3","hash":"f800b399e5c7a5254fc66bb407117fe38dbde0528780e68c9f7c87d299f8486a"},{"filename":"jquery.js","version":"1.4.2","hash":"95c023c80dfe0d30304c58244878995061f87801a66daa5d6bf4f2512be0e6f9"},{"filename":"jquery.min.js","version":"1.4.2","hash":"e23a2a4e2d7c2b41ebcdd8ffc0679df7140eb7f52e1eebabf827a88182643c59"},{"filename":"jquery.js","version":"1.4.1","hash":"9edc9f813781eca2aad6de78ef85cdbe92ee32bb0a56791be4da0fa7b472c1d8"},{"filename":"jquery.min.js","version":"1.4.1","hash":"2cec78f739fbddfed852cd7934d2530e7cc4c8f14b38673b03ba5fb880ad4cc7"},{"filename":"jquery.js","version":"1.4.0","hash":"882927b9aadb2504b5c6a823bd8c8c516f21dec6e441fe2c8fa228e35951bcc8"},{"filename":"jquery.min.js","version":"1.4.0","hash":"89abaf1e2471b00525b0694048e179c0f39a2674e3bcb34460ea6bc4801882be"},{"filename":"jquery.js","version":"1.3.2","hash":"74537639fa585509395c0d3b9a5601dd1e4ca036961c53dc5ab0e87386aa9be1"},{"filename":"jquery.min.js","version":"1.3.2","hash":"c8370a2d050359e9d505acc411e6f457a49b21360a21e6cbc9229bad3a767899"},{"filename":"jquery.js","version":"1.3.1","hash":"0ae058559b3e65d6cc5674fe3ff01581da5ae62387bb0dfa2923997a52093a06"},{"filename":"jquery.min.js","version":"1.3.1","hash":"17ec1f16efac893b9bd89bba5f13cb1e0bf938bdc9cece6cae3ed77f18fa6fd7"},{"filename":"jquery.js","version":"1.3.0","hash":"a7756f21ff6c558f983d5376072174af546e8d07f8bebe1e6f760b2f4b53012d"},{"filename":"jquery.min.js","version":"1.3.0","hash":"900191a443115d8b48a9d68d3062e8b3d7129727951b8617465b485baf253006"},{"filename":"jquery.js","version":"1.2.6","hash":"3cc5c121471323b25de45fcab48631d4a09c78e76af21c10d747352682605587"},{"filename":"jquery.min.js","version":"1.2.6","hash":"d548530775a6286f49ba66e0715876b4ec5985966b0291c21568fecfc4178e8d"},{"filename":"jquery.js","version":"1.2.3","hash":"d977fc32dd4bdb0479604abf078f1045b0e922666313f2f42cd71ce7835e0061"},{"filename":"jquery.min.js","version":"1.2.3","hash":"f1c4a0a7b5dead231fc9b42f06965a036ab7a2a788768847eb81e1528d6402ad"}]}
};

},{}],9:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
* *
* Copyright (C) 2018 Nathan Nichols
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

var data = require("./license_definitions.js");
var match_utils = require("./pattern_utils.js").patternUtils;

var licStartLicEndRe = /@licstartThefollowingistheentirelicensenoticefortheJavaScriptcodeinthis(?:page|file)(.*)?@licendTheaboveistheentirelicensenoticefortheJavaScriptcodeinthis(?:page|file)/mi;


/**
 * stripLicenseToRegexp
 *
 * Removes all non-alphanumeric characters except for the 
 * special tokens, and replace the text values that are 
 * hardcoded in license_definitions.js
 *
 */
var stripLicenseToRegexp = function (license) {
	var max = license.licenseFragments.length;
	var item;
	for (var i = 0; i < max; i++) {
		item = license.licenseFragments[i];
		item.regex = match_utils.removeNonalpha(item.text);
		item.regex = new RegExp(
			match_utils.replaceTokens(item.regex), '');
	}
	return license;
};

var	license_regexes = [];

var init = function(){
	console.log("initializing regexes");
	for (var item in data.licenses) {
		license_regexes.push(stripLicenseToRegexp(data.licenses[item]));
	}
	//console.log(license_regexes);
}

module.exports.init = init;

/**
*
*	Takes in the declaration that has been preprocessed and 
*	tests it against regexes in our table.
*/
var search_table = function(stripped_comment){
	var stripped = match_utils.removeNonalpha(stripped_comment); 
	//stripped = stripped.replaceTokens(stripped_comment); 

	//console.log("Looking up license");
	//console.log(stripped);

    for (license in data.licenses) {	    
		frag = data.licenses[license].licenseFragments;
		max_i = data.licenses[license].licenseFragments.length;
		for (i = 0; i < max_i; i++) {
		    if (frag[i].regex.test(stripped)) {
			//console.log(data.licenses[license].licenseName);
			return data.licenses[license].licenseName;
		    }
		}
	}	
	console.log("No global license found.");
	return false;

}

/**
*	Takes the "first comment available on the page"
*	returns true for "free" and false for anything else	
*/
var check = function(license_text){
	//console.log("checking...");
	//console.log(license_text);

	if(license_text === undefined || license_text === null || license_text == ""){
		//console.log("Was not an inline script");
		return false;
	}
	// remove whitespace
	var stripped = match_utils.removeWhitespace(license_text);
	// Search for @licstart/@licend
	// This assumes that there isn't anything before the comment
	var matches = stripped.match(licStartLicEndRe);
	if(matches == null){
		return false;
	}
	var declaration = matches[0];

	return search_table(declaration);

};

module.exports.check = check;

},{"./license_definitions.js":10,"./pattern_utils.js":17}],10:[function(require,module,exports){
/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 * *
 * Copyright (C) 2011, 2012, 2013, 2014 Loic J. Duros
 * Copyright (C) 2014, 2015 Nik Nyby
 *
 * This file is part of GNU LibreJS.
 *
 * GNU LibreJS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * GNU LibreJS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
 */
exports.types = {
    SHORT: 'short',
    LAZY: 'lazy',
    FULL: 'full'
};

var type = exports.types;

/**
 * List of all the licenses.
 * Currently only short substrings are used with regex.
 *
 * The licenses are indexed by their "Identifier", which, when possible,
 * corresponds to their identifier as specified by SPDX here:
 *   https://spdx.org/licenses/
 */
exports.licenses = {
    'CC0-1.0': {
        licenseName: 'Creative Commons CC0 1.0 Universal',
        identifier: 'CC0-1.0',
        canonicalUrl: [
            'http://creativecommons.org/publicdomain/zero/1.0/legalcode',
            'magnet:?xt=urn:btih:90dc5c0be029de84e523b9b3922520e79e0e6f08&dn=cc0.txt'
        ],
        licenseFragments: []
    },


    'GPL-2.0': {
        licenseName: 'GNU General Public License (GPL) version 2',
        identifier: 'GPL-2.0',
        canonicalUrl: [
            'http://www.gnu.org/licenses/gpl-2.0.html',
            'magnet:?xt=urn:btih:cf05388f2679ee054f2beb29a391d25f4e673ac3&dn=gpl-2.0.txt'
        ],
        licenseFragments: [{text: "<THISPROGRAM> is free software; you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation; either version 2 of the License, or (at your option) any later version.", type: type.SHORT},
        {text:"Alternatively, the contents of this file may be used under the terms of either the GNU General Public License Version 2 or later (the \"GPL\"), or the GNU Lesser General Public License Version 2.1 or later (the \"LGPL\"), in which case the provisions of the GPL or the LGPL are applicable instead of those above. If you wish to allow use of your version of this file only under the terms of either the GPL or the LGPL, and not to allow others to use your version of this file under the terms of the MPL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the GPL or the LGPL. If you do not delete the provisions above, a recipient may use your version of this file under the terms of any one of the MPL, the GPL or the LGPL.", type: type.SHORT}]
    },

    'GPL-3.0': {
        licenseName: 'GNU General Public License (GPL) version 3',
        identifier: 'GPL-3.0',
        canonicalUrl: [
            'http://www.gnu.org/licenses/gpl-3.0.html',
            'magnet:?xt=urn:btih:1f739d935676111cfff4b4693e3816e664797050&dn=gpl-3.0.txt'
        ],
        licenseFragments: [
        {text: "<THISPROGRAM> is free software: you can redistribute it and/or modify it under the terms of the GNU  General Public License (GNU GPL) as published by the Free Software  Foundation, either version 3 of the License, or (at your option)  any later version. The code is distributed WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU GPL for more details. As additional permission under GNU GPL version 3 section 7, you may distribute non-source (e.g., minimized or compacted) forms of that code without the copy of the GNU GPL normally required by section 4, provided you include this license notice and a URL through which recipients can access the Corresponding Source.", type: type.SHORT},
        {text: "<THISPROGRAM> is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.", type: type.SHORT}]
    },

    'GNU-All-Permissive': {
        licenseName: 'GNU All-Permissive License',
        licenseFragments: [{text: "Copying and distribution of this file, with or without modification, are permitted in any medium without royalty provided the copyright notice and this notice are preserved. This file is offered as-is, without any warranty.", type: type.SHORT}]
    },

    'Apache-2.0': {
        licenseName: 'Apache License, Version 2.0',
        identifier: 'Apache-2.0',
        canonicalUrl: [
            'http://www.apache.org/licenses/LICENSE-2.0',
            'magnet:?xt=urn:btih:8e4f440f4c65981c5bf93c76d35135ba5064d8b7&dn=apache-2.0.txt'
        ],
        licenseFragments: [{text: "Licensed under the Apache License, Version 2.0 (the \"License\"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0", type: type.SHORT}]
    },

    'LGPL-2.1': {
        licenseName: 'GNU Lesser General Public License, version 2.1',
        identifier: 'LGPL-2.1',
        canonicalUrl: [
            'http://www.gnu.org/licenses/lgpl-2.1.html',
            'magnet:?xt=urn:btih:5de60da917303dbfad4f93fb1b985ced5a89eac2&dn=lgpl-2.1.txt'
        ],
        licenseFragments: [{text: "<THISLIBRARY> is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option) any later version.", type: type.SHORT}]
    },

    'LGPL-3.0': {
        licenseName: 'GNU Lesser General Public License, version 3',
        identifier: 'LGPL-3.0',
        canonicalUrl: [
            'http://www.gnu.org/licenses/lgpl-3.0.html',
            'magnet:?xt=urn:btih:0ef1b8170b3b615170ff270def6427c317705f85&dn=lgpl-3.0.txt'
        ],
        licenseFragments: [{text: "<THISPROGRAM> is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.", type: type.SHORT}]
    },

    'AGPL-3.0': {
        licenseName: 'GNU AFFERO GENERAL PUBLIC LICENSE version 3',
        identifier: 'AGPL-3.0',
        canonicalUrl: [
            'http://www.gnu.org/licenses/agpl-3.0.html',
            'magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt'
        ],

        licenseFragments: [{text: "<THISPROGRAM> is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.", type: type.SHORT}]
    },

    'BSL-1.0': {
        licenseName: 'Boost Software License 1.0',
        identifier: 'BSL-1.0',
        canonicalUrl: [
            'http://www.boost.org/LICENSE_1_0.txt',
            'magnet:?xt=urn:btih:89a97c535628232f2f3888c2b7b8ffd4c078cec0&dn=Boost-1.0.txt'
        ],
        licenseFragments: [{text: "Boost Software License <VERSION> <DATE> Permission is hereby granted, free of charge, to any person or organization obtaining a copy of the software and accompanying documentation covered by this license (the \"Software\") to use, reproduce, display, distribute, execute, and transmit the Software, and to prepare derivative works of the Software, and to permit third-parties to whom the Software is furnished to do so, all subject to the following", type: type.SHORT}]
    },

    'BSD-3-Clause': {
        licenseName: "BSD 3-Clause License",
        identifier: 'BSD-3-Clause',
        canonicalUrl: [
            'http://opensource.org/licenses/BSD-3-Clause',
            'magnet:?xt=urn:btih:c80d50af7d3db9be66a4d0a86db0286e4fd33292&dn=bsd-3-clause.txt'
        ],
        licenseFragments: [{text: "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution. Neither the name of <ORGANIZATION> nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.", type: type.SHORT}]
    },

    'BSD-2-Clause': {
        licenseName: "BSD 2-Clause License",
        identifier: 'BSD-2-Clause',
        licenseFragments: [{text: "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.", type: type.SHORT}]
    },

    'EPL-1.0': {
	    licenseName: "Eclipse Public License Version 1.0",
	    identifier: "EPL-1.0",
	    canonicalUrl: [
	        "http://www.eclipse.org/legal/epl-v10.html",
	        "magnet:?xt=urn:btih:4c6a2ad0018cd461e9b0fc44e1b340d2c1828b22&dn=epl-1.0.txt"
	    ],
	    licenseFragments: [
	        {
		        text: "THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS OF THIS ECLIPSE PUBLIC LICENSE (\"AGREEMENT\"). ANY USE, REPRODUCTION OR DISTRIBUTION OF THE PROGRAM CONSTITUTES RECIPIENT'S ACCEPTANCE OF THIS AGREEMENT.",
		        type: type.SHORT
	        }
	    ]
    },

    'MPL-2.0': {
        licenseName: 'Mozilla Public License Version 2.0',
        identifier: 'MPL-2.0',
        canonicalUrl: [
            'http://www.mozilla.org/MPL/2.0',
            'magnet:?xt=urn:btih:3877d6d54b3accd4bc32f8a48bf32ebc0901502a&dn=mpl-2.0.txt'
        ],
        licenseFragments: [{text: "This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at http://mozilla.org/MPL/2.0/.", type: type.SHORT }]
    },

    'Expat': {
        licenseName: 'Expat License (sometimes called MIT Licensed)',
        identifier: 'Expat',
        canonicalUrl: [
            'http://www.jclark.com/xml/copying.txt',
            'magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt'
        ],
        licenseFragments: [{text: "Copyright <YEAR> <NAME> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.", type: type.SHORT}]
    },

    'UPL': {
        licenseName: 'Universal Permissive License',
        identifier: 'UPL-1.0',
        canonicalUrl: [
            'magnet:?xt=urn:btih:5305d91886084f776adcf57509a648432709a7c7&dn=x11.txt'
        ],
        licenseFragments: [{
            text: "The Universal Permissive License (UPL), Version 1.0",
            type: type.SHORT
        }]
    },

    'X11': {
        licenseName: 'X11 License',
        identifier: 'X11',
        canonicalUrl: [
            'magnet:?xt=urn:btih:5305d91886084f776adcf57509a648432709a7c7&dn=x11.txt'
        ],
        licenseFragments: [{text: "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.", type: type.SHORT}]
    },

    'XFree86-1.1': {
        licenseName: "XFree86 1.1 License",
        identifier: 'XFree86-1.1',
        canonicalUrl: [
            'http://www.xfree86.org/3.3.6/COPYRIGHT2.html#3',
            'http://www.xfree86.org/current/LICENSE4.html',
            'magnet:?xt=urn:btih:12f2ec9e8de2a3b0002a33d518d6010cc8ab2ae9&dn=xfree86.txt'
        ],
        licenseFragments: [{text: "All rights reserved.\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n1. Redistributions of source code must retain the above copyright notice, this list of conditions, and the following disclaimer.\n2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution, and in the same place and form as other copyright, license and disclaimer information.\n3. The end-user documentation included with the redistribution, if any, must include the following acknowledgment: \"This product includes software developed by The XFree86 Project, Inc (http://www.xfree86.org/) and its contributors\", in the same place and form as other third-party acknowledgments. Alternately, this acknowledgment may appear in the software itself, in the same form and location as other such third-party acknowledgments.4. Except as contained in this notice, the name of The XFree86 Project, Inc shall not be used in advertising or otherwise to promote the sale, use or other dealings in this Software without prior written authorization from The XFree86 Project, Inc.", type: type.SHORT}
        ]
    },

    'FreeBSD': {
        licenseName: "FreeBSD License",
        identifier: 'FreeBSD',
        canonicalUrl: [
            'http://www.freebsd.org/copyright/freebsd-license.html',
            'magnet:?xt=urn:btih:87f119ba0b429ba17a44b4bffcab33165ebdacc0&dn=freebsd.txt'
        ],
        licenseFragments: [{text: "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:\n\nRedistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.\n\nRedistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.", type: type.SHORT}]
    },

    'ISC': {
        licenseName: "The ISC License",
        identifier: 'ISC',
        canonicalUrl: [
            'https://www.isc.org/downloads/software-support-policy/isc-license/',
            'magnet:?xt=urn:btih:b8999bbaf509c08d127678643c515b9ab0836bae&dn=ISC.txt'
        ],
        licenseFragments: [{text: "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\" AND ISC DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL ISC BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.", type: type.SHORT},
        {text: "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.THE SOFTWARE IS PROVIDED \"AS IS\" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.", type: type.SHORT}]
    },

    'jQueryTools': {
        licenseName: "jQuery Tools",
        licenseFragments: [{
            text: 'NO COPYRIGHTS OR LICENSES. DO WHAT YOU LIKE.',
            type: type.SHORT
        }]
    },

    'Artistic-2.0': {
        licenseName: "Artistic License 2.0",
        identifier: 'Artistic-2.0',
        canonicalUrl: [
            "http://www.perlfoundation.org/artistic_license_2_0",
            "magnet:?xt=urn:btih:54fd2283f9dbdf29466d2df1a98bf8f65cafe314&dn=artistic-2.0.txt"
        ],
        licenseFragments: []
    },

    'PublicDomain': {
        licenseName: "Public Domain",
        canonicalUrl: [
            'magnet:?xt=urn:btih:e95b018ef3580986a04669f1b5879592219e2a7a&dn=public-domain.txt'
        ],
        licenseFragments: []
    },

    'CPAL-1.0': {
        licenseName: 'Common Public Attribution License Version 1.0 (CPAL)',
        identifier: 'CPAL-1.0',
        canonicalUrl: [
            'http://opensource.org/licenses/cpal_1.0',
            'magnet:?xt=urn:btih:84143bc45939fc8fa42921d619a95462c2031c5c&dn=cpal-1.0.txt'
        ],
        licenseFragments: [
            {
                text: 'The contents of this file are subject to the Common Public Attribution License Version 1.0',
                type: type.SHORT
            },
            {
                text: 'The term "External Deployment" means the use, distribution, or communication of the Original Code or Modifications in any way such that the Original Code or Modifications may be used by anyone other than You, whether those works are distributed or communicated to those persons or made available as an application intended for use over a network. As an express condition for the grants of license hereunder, You must treat any External Deployment by You of the Original Code or Modifications as a distribution under section 3.1 and make Source Code available under Section 3.2.',
                type: type.SHORT
            }
        ]
    },
    'WTFPL': {
        licenseName: 'Do What The F*ck You Want To Public License (WTFPL)',
        identifier: 'WTFPL',
        canonicalUrl: [
            'http://www.wtfpl.net/txt/copying/',
            'magnet:?xt=urn:btih:723febf9f6185544f57f0660a41489c7d6b4931b&dn=wtfpl.txt'
        ],
        licenseFragments: [
            {
                text: 'DO WHAT THE FUCK YOU WANT TO PUBLIC LICENSE',
                type: type.SHORT
            },
            {
                text: '0. You just DO WHAT THE FUCK YOU WANT TO.',
                type: type.SHORT
            }
        ]
    },
    'Unlicense': {
        licenseName: 'Unlicense',
        identifier: 'Unlicense',
        canonicalUrl: [
            'http://unlicense.org/UNLICENSE',
            'magnet:?xt=urn:btih:5ac446d35272cc2e4e85e4325b146d0b7ca8f50c&dn=unlicense.txt'
        ],
        licenseFragments: [
            {
                text: 'This is free and unencumbered software released into the public domain.',
                type: type.SHORT
            },
        ]
    }
};

},{}],11:[function(require,module,exports){
module.exports=module.exports = {	
	licenses: {
		'Apache-2.0':{
			'Name': 'Apache 2.0',
			'URL': 'http://www.apache.org/licenses/LICENSE-2.0',
			'Magnet link': 'magnet:?xt=urn:btih:8e4f440f4c65981c5bf93c76d35135ba5064d8b7&dn=apache-2.0.txt'
		},
		'Artistic-2.0':{
			'Name': 'Artistic 2.0',
			'URL': 'http://www.perlfoundation.org/artistic_license_2_0',
			'Magnet link': 'magnet:?xt=urn:btih:54fd2283f9dbdf29466d2df1a98bf8f65cafe314&dn=artistic-2.0.txt'
		},
		'Boost':{
			'Name': 'Boost',
			'URL': 'http://www.boost.org/LICENSE_1_0.txt',
			'Magnet link': 'magnet:?xt=urn:btih:89a97c535628232f2f3888c2b7b8ffd4c078cec0&dn=Boost-1.0.txt'
		},
		'CPAL-1.0':{
			'Name': 'CPAL 1.0',
			'URL': 'http://opensource.org/licenses/cpal_1.0',
			'Magnet link': 'magnet:?xt=urn:btih:84143bc45939fc8fa42921d619a95462c2031c5c&dn=cpal-1.0.txt'
		},
		'CC0-1.0':{
			'Name': 'CC0 1.0',
			'URL': 'http://creativecommons.org/publicdomain/zero/1.0/legalcode',
			'Magnet link': 'magnet:?xt=urn:btih:90dc5c0be029de84e523b9b3922520e79e0e6f08&dn=cc0.txt'
		},
		'CC-BY-SA-1.0':{
			'Name': 'CC-BY-SA 1.0',
			'URL': 'https://creativecommons.org/licenses/by-sa/1.0/',
			'Magnet link': ''
		},
		'CC-BY-SA-2.0':{
			'Name': 'CC-BY-SA 2.0',
			'URL': 'https://creativecommons.org/licenses/by-sa/2.0/',
			'Magnet link': ''
		},
		'CC-BY-SA-2.5':{
			'Name': 'CC-BY-SA 2.5',
			'URL': 'https://creativecommons.org/licenses/by-sa/2.5/',
			'Magnet link': ''
		},
		'CC-BY-SA-3.0':{
			'Name': 'CC-BY-SA 3.0',
			'URL': 'https://creativecommons.org/licenses/by-sa/3.0/',
			'Magnet link': ''
		},
		'CC-BY-SA-4.0':{
			'Name': 'CC-BY-SA 4.0',
			'URL': 'https://creativecommons.org/licenses/by-sa/4.0/',
			'Magnet link': ''
		},
		'CC-BY-1.0':{
			'Name': 'CC-BY 1.0',
			'URL': 'https://creativecommons.org/licenses/by/1.0/',
			'Magnet link': ''
		},
		'CC-BY-2.0':{
			'Name': 'CC-BY 2.0',
			'URL': 'https://creativecommons.org/licenses/by/2.0/',
			'Magnet link': ''
		},
		'CC-BY-2.5':{
			'Name': 'CC-BY 2.5',
			'URL': 'https://creativecommons.org/licenses/by/2.5/',
			'Magnet link': ''
		},
		'CC-BY-3.0':{
			'Name': 'CC-BY 3.0',
			'URL': 'https://creativecommons.org/licenses/by/3.0/',
			'Magnet link': ''
		},
		'CC-BY-4.0':{
			'Name': 'CC-BY 4.0',
			'URL': 'https://creativecommons.org/licenses/by/4.0/',
			'Magnet link': ''
		},
		'EPL-1.0':{
			'Name': 'EPL 1.0',
			'URL': 'http://www.eclipse.org/legal/epl-v10.html',
			'Magnet link': 'magnet:?xt=urn:btih:4c6a2ad0018cd461e9b0fc44e1b340d2c1828b22&dn=epl-1.0.txt'
		},
		'Expat':{
			'Name': 'Expat',
			'URL': 'http://www.jclark.com/xml/copying.txt',
			'Magnet link': 'magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt'
		},
		'MIT':{
			'Name': 'Expat',
			'URL': 'http://www.jclark.com/xml/copying.txt',
			'Magnet link': 'magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt'
		},
		'X11':{
			'Name': 'X11',
			'URL': 'http://www.xfree86.org/3.3.6/COPYRIGHT2.html#3',
			'Magnet link': 'magnet:?xt=urn:btih:5305d91886084f776adcf57509a648432709a7c7&dn=x11.txt'	
		},
		'GPL-2.0':{
			'Name': 'GPL 2.0',
			'URL': 'http://www.gnu.org/licenses/gpl-2.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:cf05388f2679ee054f2beb29a391d25f4e673ac3&dn=gpl-2.0.txt'
		},
		'GPL-3.0':{
			'Name': 'GPL 3.0',
			'URL': 'http://www.gnu.org/licenses/gpl-3.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:1f739d935676111cfff4b4693e3816e664797050&dn=gpl-3.0.txt'
		},
		'LGPL-2.1':{
			'Name': 'LGPL 2.1',
			'URL': 'http://www.gnu.org/licenses/lgpl-2.1.html',
			'Magnet link': 'magnet:?xt=urn:btih:5de60da917303dbfad4f93fb1b985ced5a89eac2&dn=lgpl-2.1.txt'
		},
		'LGPL-3.0':{
			'Name': 'LGPL 3.0',
			'URL': 'http://www.gnu.org/licenses/lgpl-3.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:0ef1b8170b3b615170ff270def6427c317705f85&dn=lgpl-3.0.txt'
		},
		'AGPL-3.0':{
			'Name': 'AGPL 3.0',
			'URL': 'http://www.gnu.org/licenses/agpl-3.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt'
		},
		'GPL-2.0-only':{
			'Name': 'GPL 2.0',
			'URL': 'http://www.gnu.org/licenses/gpl-2.0.html',
			'Magnet link': ''
		},
		'GPL-3.0-only':{
			'Name': 'GPL 3.0',
			'URL': 'http://www.gnu.org/licenses/gpl-3.0.html',
			'Magnet link': ''
		},
		'LGPL-2.1-only':{
			'Name': 'LGPL 2.1',
			'URL': 'http://www.gnu.org/licenses/lgpl-2.1.html',
			'Magnet link': ''
		},
		'LGPL-3.0-only':{
			'Name': 'LGPL 3.0',
			'URL': 'http://www.gnu.org/licenses/lgpl-3.0.html',
			'Magnet link': ''
		},
		'AGPL-3.0-only':{
			'Name': 'AGPL 3.0',
			'URL': 'http://www.gnu.org/licenses/agpl-3.0.html',
			'Magnet link': ''
		},
		'GPL-2.0-or-later':{
			'Name': 'GPL 2.0 or later',
			'URL': 'http://www.gnu.org/licenses/gpl-2.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:cf05388f2679ee054f2beb29a391d25f4e673ac3&dn=gpl-2.0.txt'
		},
		'GPL-3.0-or-later':{
			'Name': 'GPL 3.0 or later',
			'URL': 'http://www.gnu.org/licenses/gpl-3.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:1f739d935676111cfff4b4693e3816e664797050&dn=gpl-3.0.txt'
		},
		'LGPL-2.1-or-later':{
			'Name': 'LGPL 2.1 or later',
			'URL': 'http://www.gnu.org/licenses/lgpl-2.1.html',
			'Magnet link': 'magnet:?xt=urn:btih:5de60da917303dbfad4f93fb1b985ced5a89eac2&dn=lgpl-2.1.txt'
		},
		'LGPL-3.0-or-later':{
			'Name': 'LGPL 3.0 or later',
			'URL': 'http://www.gnu.org/licenses/lgpl-3.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:0ef1b8170b3b615170ff270def6427c317705f85&dn=lgpl-3.0.txt'
		},
		'AGPL-3.0-or-later':{
			'Name': 'AGPL 3.0 or later',
			'URL': 'http://www.gnu.org/licenses/agpl-3.0.html',
			'Magnet link': 'magnet:?xt=urn:btih:0b31508aeb0634b347b8270c7bee4d411b5d4109&dn=agpl-3.0.txt'
		},
		'ISC':{
			'Name': 'ISC',
			'URL': 'https://www.isc.org/downloads/software-support-policy/isc-license/',
			'Magnet link': 'magnet:?xt=urn:btih:b8999bbaf509c08d127678643c515b9ab0836bae&dn=ISC.txt'
		},
		'MPL-2.0':{
			'Name': 'MPL 2.0',
			'URL': 'http://www.mozilla.org/MPL/2.0',
			'Magnet link': 'magnet:?xt=urn:btih:3877d6d54b3accd4bc32f8a48bf32ebc0901502a&dn=mpl-2.0.txt'
		},
		'UPL-1.0': {
			'Name': 'UPL 1.0',
			'URL': 'https://oss.oracle.com/licenses/upl/',
			'Magnet link': 'magnet:?xt=urn:btih:478974f4d41c3fa84c4befba25f283527fad107d&dn=upl-1.0.txt'
		},
		'WTFPL': {
			'Name': 'WTFPL',
			'URL': 'http://www.wtfpl.net/txt/copying/',
			'Magnet link': 'magnet:?xt=urn:btih:723febf9f6185544f57f0660a41489c7d6b4931b&dn=wtfpl.txt'
		},
		'Unlicense':{
			'Name': 'Unlicense',
			'URL': 'http://unlicense.org/UNLICENSE',
			'Magnet link': 'magnet:?xt=urn:btih:5ac446d35272cc2e4e85e4325b146d0b7ca8f50c&dn=unlicense.txt'
		},
		'FreeBSD':{
			'Name': 'FreeBSD',
			'URL': 'http://www.freebsd.org/copyright/freebsd-license.html',
			'Magnet link': 'magnet:?xt=urn:btih:87f119ba0b429ba17a44b4bffcab33165ebdacc0&dn=freebsd.txt'
		},
		'BSD-2-Clause':{
			'Name': 'FreeBSD (BSD-2-Clause)',
			'URL': 'http://www.freebsd.org/copyright/freebsd-license.html',
			'Magnet link': ''
		},
		'BSD-3-Clause':{
			'Name': 'Modified BSD (BSD-3-Clause)',
			'URL': 'http://opensource.org/licenses/BSD-3-Clause',
			'Magnet link': 'magnet:?xt=urn:btih:c80d50af7d3db9be66a4d0a86db0286e4fd33292&dn=bsd-3-clause.txt'
		},
		'XFree86-1.1':{
			'Name': 'XFree86 1.1',
			'URL': 'http://www.xfree86.org/current/LICENSE4.html',
			'Magnet link': 'magnet:?xt=urn:btih:12f2ec9e8de2a3b0002a33d518d6010cc8ab2ae9&dn=xfree86.txt'
		}
	}
};

},{}],12:[function(require,module,exports){
/**
* GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
* *
* Copyright (C) 2017, 2018 Nathan Nichols
* Copyright (C) 2018 Ruben Rodriguez <ruben@gnu.org>
*
* This file is part of GNU LibreJS.
*
* GNU LibreJS is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* GNU LibreJS is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
*/

var acorn = require('acorn');
var acornLoose = require('acorn-loose');
var legacy_license_lib = require("./legacy_license_check.js");
var {ResponseProcessor} = require("./bg/ResponseProcessor");
var {Storage, ListStore, hash} = require("./common/Storage");
var {ListManager} = require("./bg/ListManager");
var {ExternalLicenses} = require("./bg/ExternalLicenses");

console.log("main_background.js");
/**
*	If this is true, it evaluates entire scripts instead of returning as soon as it encounters a violation.
*
*	Also, it controls whether or not this part of the code logs to the console.
*
*/
var DEBUG = false; // debug the JS evaluation
var PRINT_DEBUG = false; // Everything else
var time = Date.now();

function dbg_print(a,b){
	if(PRINT_DEBUG == true){
		console.log("Time spent so far: " + (Date.now() - time)/1000 + " seconds");
		if(b === undefined){
			console.log(a);
		} else{
			console.log(a,b);
		}
	}
}

/*
	NONTRIVIAL THINGS:
	- Fetch
	- XMLhttpRequest
	- eval()
	- ?
	JAVASCRIPT CAN BE FOUND IN:
	- Event handlers (onclick, onload, onsubmit, etc.)
	- <script>JS</script>
	- <script src="/JS.js"></script>
	WAYS TO DETERMINE PASS/FAIL:
	- "// @license [magnet link] [identifier]" then "// @license-end" (may also use /* comments)
	- Automatic whitelist: (http://bzr.savannah.gnu.org/lh/librejs/dev/annotate/head:/data/script_libraries/script-libraries.json_
*/
var licenses = require("./licenses.json").licenses;

// These are objects that it will search for in an initial regex pass over non-free scripts.
var reserved_objects = [
	//"document",
	//"window",
	"fetch",
	"XMLHttpRequest",
	"chrome", // only on chrome
	"browser", // only on firefox
	"eval"
];

// Generates JSON key for local storage
function get_storage_key(script_name,src_hash){
	return script_name;
}

/*
*
*	Called when something changes the persistent data of the add-on.
*
*	The only things that should need to change this data are:
*	a) The "Whitelist this page" button
*	b) The options screen
*
*	When the actual blocking is implemented, this will need to comminicate
*	with its code to update accordingly
*
*/
function options_listener(changes, area){
	// The cache must be flushed when settings are changed
	// TODO: See if this can be minimized
	function flushed(){
		dbg_print("cache flushed");
	}
	//var flushingCache = browser.webRequest.handlerBehaviorChanged(flushed);


	dbg_print("Items updated in area" + area +": ");

	var changedItems = Object.keys(changes);
	var changed_items = "";
	for (var i = 0; i < changedItems.length; i++){
		var item = changedItems[i];
		changed_items += item + ",";
	}
	dbg_print(changed_items);

}


var activeMessagePorts = {};
var activityReports = {};
async function createReport(initializer) {
	if (!(initializer && (initializer.url || initializer.tabId)))  {
		throw new Error("createReport() needs an URL or a tabId at least");
	}
	let template =  {
		"accepted": [],
		"blocked": [],
		"blacklisted": [],
		"whitelisted": [],
		"unknown": [],
	};
	template = Object.assign(template, initializer);
	let [url] = (template.url || (await browser.tabs.get(initializer.tabId)).url).split("#");
	template.url = url;
	template.site = ListStore.siteItem(url);
	template.siteStatus = listManager.getStatus(template.site);
	let list = {"whitelisted": whitelist, "blacklisted": blacklist}[template.siteStatus];
	if (list) {
		template.listedSite = ListManager.siteMatch(template.site, list);
	}
	return template;
}

/**
*	Executes the "Display this report in new tab" function
*	by opening a new tab with whatever HTML is in the popup
*	at the moment.
*/
async function openReportInTab(data) {
	let popupURL = await browser.browserAction.getPopup({});
	let tab = await browser.tabs.create({url: `${popupURL}#fromTab=${data.tabId}`});
	activityReports[tab.id] = await createReport(data);
}

/**
*
*	Clears local storage (the persistent data)
*
*/
function debug_delete_local(){
	browser.storage.local.clear();
	dbg_print("Local storage cleared");
}

/**
*
*	Prints local storage (the persistent data) as well as the temporary popup object
*
*/
function debug_print_local(){
	function storage_got(items){
		console.log("%c Local storage: ", 'color: red;');
		for(var i in items){
			console.log("%c "+i+" = "+items[i], 'color: blue;');
		}
	}
	console.log("%c Variable 'activityReports': ", 'color: red;');
	console.log(activityReports);
	browser.storage.local.get(storage_got);
}

/**
*
*
*	Sends a message to the content script that sets the popup entries for a tab.
*
*	var example_blocked_info = {
*		"accepted": [["REASON 1","SOURCE 1"],["REASON 2","SOURCE 2"]],
*		"blocked": [["REASON 1","SOURCE 1"],["REASON 2","SOURCE 2"]],
*		"url": "example.com"
*	}
*
*	NOTE: This WILL break if you provide inconsistent URLs to it.
*	Make sure it will use the right URL when refering to a certain script.
*
*/
async function updateReport(tabId, oldReport, updateUI = false){
	let {url} = oldReport;
	let newReport = await createReport({url, tabId});
	for (let property of Object.keys(oldReport)) {
		let entries = oldReport[property];
		if (!Array.isArray(entries)) continue;
		let defValue = property === "accepted" || property === "blocked" ? property : "unknown";
		for (let script of entries) {
			let status = listManager.getStatus(script[0],  defValue);
			if (Array.isArray(newReport[status])) newReport[status].push(script);
		}
	}
	activityReports[tabId] = newReport;
	if (browser.sessions) browser.sessions.setTabValue(tabId, url, newReport);
	dbg_print(newReport);
	if (updateUI && activeMessagePorts[tabId]) {
		dbg_print(`[TABID: ${tabId}] Sending script blocking report directly to browser action.`);
		activeMessagePorts[tabId].postMessage({show_info: newReport});
	}
}

/**
*
*	This is what you call when a page gets changed to update the info box.
*
*	Sends a message to the content script that adds a popup entry for a tab.
*
*	The action argument is an object with two properties: one named either
* "accepted","blocked", "whitelisted", "blacklisted" or "unknown", whose value
* is the array [scriptName, reason], and another named "url". Example:
* action = {
*		"accepted": ["jquery.js (someHash)","Whitelisted by user"],
*		"url": "https://example.com/js/jquery.js"
*	}
*
*	Returns either "whitelisted, "blacklisted", "blocked", "accepted" or "unknown"
*
*	NOTE: This WILL break if you provide inconsistent URLs to it.
*	Make sure it will use the right URL when refering to a certain script.
*
*/
async function addReportEntry(tabId, scriptHashOrUrl, action) {
	let report = activityReports[tabId];
	if (!report) report = activityReports[tabId] =
			await createReport({tabId});
	let type, actionValue;
	for (type of ["accepted", "blocked", "whitelisted", "blacklisted"]) {
		if (type in action) {
			actionValue = action[type];
			break;
		}
	}
	if (!actionValue) {
		console.debug("Something wrong with action", action);
		return "";
	}

	// Search unused data for the given entry
	function isNew(entries, item) {
		for (let e of entries) {
			if (e[0] === item) return false;
		}
		return true;
	}

	let entryType;
	let scriptName = actionValue[0];
	try {
		entryType = listManager.getStatus(scriptName, type);
		let entries = report[entryType];
		if(isNew(entries, scriptName)){
			dbg_print(activityReports);
			dbg_print(activityReports[tabId]);
			dbg_print(entryType);
			entries.push(actionValue);
		}
	} catch (e) {
		console.error("action %o, type %s, entryType %s", action, type, entryType, e);
		entryType = "unknown";
	}

	if (activeMessagePorts[tabId]) {
		try {
			activeMessagePorts[tabId].postMessage({show_info: report});
		} catch(e) {
		}
	}

	if (browser.sessions) browser.sessions.setTabValue(tabId, report.url, report);
	updateBadge(tabId, report);
	return entryType;
}


function get_domain(url){
	var domain = url.replace('http://','').replace('https://','').split(/[/?#]/)[0];
	if(url.indexOf("http://") == 0){
		domain = "http://" + domain;
	}
	else if(url.indexOf("https://") == 0){
		domain = "https://" + domain;
	}
	domain = domain + "/";
	domain = domain.replace(/ /g,"");
	return domain;
}

/**
*
*	This is the callback where the content scripts of the browser action will contact the background script.
*
*/
var portFromCS;
async function connected(p) {
	if(p.name === "contact_finder"){
		// style the contact finder panel
		await browser.tabs.insertCSS(p.sender.tab.id, {
			file: "/content/dialog.css",
			cssOrigin: "user",
			matchAboutBlank: true,
			allFrames: true
		});

		// Send a message back with the relevant settings
		p.postMessage(await browser.storage.local.get(["prefs_subject", "prefs_body"]));
		return;
	}
	p.onMessage.addListener(async function(m) {
		var update = false;
		var contact_finder = false;

		for (let action of ["whitelist", "blacklist", "forget"]) {
			if (m[action]) {
				let [key] = m[action];
				if (m.site) {
					key = ListStore.siteItem(m.site);
				} else {
					key = ListStore.inlineItem(key) || key;
				}
				await listManager[action](key);
				update = true;
			}
		}

		if(m.report_tab){
			openReportInTab(m.report_tab);
		}
		// a debug feature
		if(m["printlocalstorage"] !== undefined){
			console.log("Print local storage");
			debug_print_local();
		}
		// invoke_contact_finder
		if(m["invoke_contact_finder"] !== undefined){
			contact_finder = true;
			await injectContactFinder();
		}
		// a debug feature (maybe give the user an option to do this?)
		if(m["deletelocalstorage"] !== undefined){
			console.log("Delete local storage");
			debug_delete_local();
		}

		let tabs = await browser.tabs.query({active: true, currentWindow: true});

		if(contact_finder){
			let tab = tabs.pop();
			dbg_print(`[TABID:${tab.id}] Injecting contact finder`);
			//inject_contact_finder(tabs[0]["id"]);
		}
		if (update || m.update && activityReports[m.tabId]) {
			let tabId = "tabId" in m ?  m.tabId : tabs.pop().id;
			dbg_print(`%c updating tab ${tabId}`, "color: red;");
			activeMessagePorts[tabId] = p;
			await updateReport(tabId, activityReports[tabId], true);
		} else {
			for(let tab of tabs) {
				if(activityReports[tab.id]){
					// If we have some data stored here for this tabID, send it
					dbg_print(`[TABID: ${tab.id}] Sending stored data associated with browser action'`);
					p.postMessage({"show_info": activityReports[tab.id]});
				} else{
					// create a new entry
					let report = activityReports[tab.id] = await createReport({"url": tab.url, tabId: tab.id});
					p.postMessage({show_info: report});
					dbg_print(`[TABID: ${tab.id}] No data found, creating a new entry for this window.`);
				}
			}
		}
	});
}

/**
*	The callback for tab closings.
*
*	Delete the info we are storing about this tab if there is any.
*
*/
function delete_removed_tab_info(tab_id, remove_info){
	dbg_print("[TABID:"+tab_id+"]"+"Deleting stored info about closed tab");
	if(activityReports[tab_id] !== undefined){
		delete activityReports[tab_id];
	}
	if(activeMessagePorts[tab_id] !== undefined){
		delete activeMessagePorts[tab_id];
	}
	ExternalLicenses.purgeCache(tab_id);
}

/**
*	Called when the tab gets updated / activated
*
*	Here we check if  new tab's url matches activityReports[tabId].url, and if
* it doesn't we use the session cached value (if any).
*
*/

async function onTabUpdated(tabId, changedInfo, tab) {
	let [url] = tab.url.split("#");
	let report = activityReports[tabId];
	if (!(report && report.url === url)) {
		let cache = browser.sessions &&
			await browser.sessions.getTabValue(tabId, url) || null;
		// on session restore tabIds may change
		if (cache && cache.tabId !== tabId) cache.tabId = tabId;
		updateBadge(tabId, activityReports[tabId] = cache);
	}
}

async function onTabActivated({tabId}) {
	await onTabUpdated(tabId, {}, await browser.tabs.get(tabId));
}

/* *********************************************************************************************** */

var fname_data = require("./fname_data.json").fname_data;

//************************this part can be tested in the HTML file index.html's script test.js****************************

function full_evaluate(script){
		var res = true;
		if(script === undefined || script == ""){
			return [true,"Harmless null script"];
		}

		var ast = acornLoose.parse(script).body[0];

		var flag = false;
		var amtloops = 0;

		var loopkeys = {"for":true,"if":true,"while":true,"switch":true};
		var operators = {"||":true,"&&":true,"=":true,"==":true,"++":true,"--":true,"+=":true,"-=":true,"*":true};
		try{
			var tokens = acorn.tokenizer(script);
		}catch(e){
			console.warn("Tokenizer could not be initiated (probably invalid code)");
			return [false,"Tokenizer could not be initiated (probably invalid code)"];
		}
		try{
			var toke = tokens.getToken();
		}catch(e){
			console.log(script);
			console.log(e);
			console.warn("couldn't get first token (probably invalid code)");
			console.warn("Continuing evaluation");
		}

		/**
		* Given the end of an identifer token, it tests for bracket suffix notation
		*/
		function being_called(end){
			var i = 0;
			while(script.charAt(end+i).match(/\s/g) !== null){
				i++;
				if(i >= script.length-1){
					return false;
				}
			}

			return script.charAt(end+i) == "(";
		}
		/**
		* Given the end of an identifer token, it tests for parentheses
		*/
		function is_bsn(end){
			var i = 0;
			while(script.charAt(end+i).match(/\s/g) !== null){
				i++;
				if(i >= script.length-1){
					return false;
				}
			}
			return script.charAt(end+i) == "[";
		}
		var error_count = 0;
		var defines_functions = false;
		while(toke !== undefined && toke.type != acorn.tokTypes.eof){
			if(toke.type.keyword !== undefined){
				//dbg_print("Keyword:");
				//dbg_print(toke);

				// This type of loop detection ignores functional loop alternatives and ternary operators

				if(toke.type.keyword == "function"){
					dbg_print("%c NOTICE: Function declaration.","color:green");
					defines_functions = true;
				}

				if(loopkeys[toke.type.keyword] !== undefined){
					amtloops++;
					if(amtloops > 3){
						dbg_print("%c NONTRIVIAL: Too many loops/conditionals.","color:red");
						if(DEBUG == false){
							return [false,"NONTRIVIAL: Too many loops/conditionals."];
						}
					}
				}
			}else if(toke.value !== undefined && operators[toke.value] !== undefined){
				// It's just an operator. Javascript doesn't have operator overloading so it must be some
				// kind of primitive (I.e. a number)
			}else if(toke.value !== undefined){
				var status = fname_data[toke.value];
				if(status === true){ // is the identifier banned?
					dbg_print("%c NONTRIVIAL: nontrivial token: '"+toke.value+"'","color:red");
					if(DEBUG == false){
						return [false,"NONTRIVIAL: nontrivial token: '"+toke.value+"'"];
					}
				}else if(status === false){// is the identifier not banned?
					// Is there bracket suffix notation?
					if(is_bsn(toke.end)){
						dbg_print("%c NONTRIVIAL: Bracket suffix notation on variable '"+toke.value+"'","color:red");
						if(DEBUG == false){
							return [false,"%c NONTRIVIAL: Bracket suffix notation on variable '"+toke.value+"'"];
						}
					}
				}else if(status === undefined){// is the identifier user defined?
					// Is there bracket suffix notation?
					if(is_bsn(toke.end)){
						dbg_print("%c NONTRIVIAL: Bracket suffix notation on variable '"+toke.value+"'","color:red");
						if(DEBUG == false){
							return [false,"NONTRIVIAL: Bracket suffix notation on variable '"+toke.value+"'"];
						}
					}
				}else{
					dbg_print("trivial token:"+toke.value);
				}
			}
			// If not a keyword or an identifier it's some kind of operator, field parenthesis, brackets
			try{
				toke = tokens.getToken();
			}catch(e){
				dbg_print("Denied script because it cannot be parsed.");
				return [false,"NONTRIVIAL: Cannot be parsed. This could mean it is a 404 error."];
			}
		}

		dbg_print("%cAppears to be trivial.","color:green;");
		if (defines_functions === true)
			return [true,"Script appears to be trivial but defines functions."];
		else
			return [true,"Script appears to be trivial."];
}


//****************************************************************************************************
/**
*	This is the entry point for full code evaluation.
*
*	Performs the initial pass on code to see if it needs to be completely parsed
*
*	This can only determine if a script is bad, not if it's good
*
*	If it passes the intitial pass, it runs the full pass and returns the result

*	It returns an array of [flag (boolean, false if "bad"), reason (string, human readable report)]
*
*/
function evaluate(script,name){
	function reserved_object_regex(object){
		var arith_operators = "\\+\\-\\*\\/\\%\\=";
		var scope_chars = "\{\}\]\[\(\)\,";
		var trailing_chars = "\s*"+"\(\.\[";
		return new RegExp("(?:[^\\w\\d]|^|(?:"+arith_operators+"))"+object+'(?:\\s*?(?:[\\;\\,\\.\\(\\[])\\s*?)',"g");
	}
	reserved_object_regex("window");
	var all_strings = new RegExp('".*?"'+"|'.*?'","gm");
	var ml_comment = /\/\*([\s\S]+?)\*\//g;
	var il_comment = /\/\/.+/gm;
	var bracket_pairs = /\[.+?\]/g;
	var temp = script.replace(/'.+?'+/gm,"'string'");
	temp = temp.replace(/".+?"+/gm,'"string"');
	temp = temp.replace(ml_comment,"");
	temp = temp.replace(il_comment,"");
	dbg_print("%c ------evaluation results for "+ name +"------","color:white");
	dbg_print("Script accesses reserved objects?");
	var flag = true;
	var reason = ""
	// 	This is where individual "passes" are made over the code
	for(var i = 0; i < reserved_objects.length; i++){
		var res = reserved_object_regex(reserved_objects[i]).exec(temp);
		if(res != null){
			dbg_print("%c fail","color:red;");
			flag = false;
			reason = "Script uses a reserved object (" + reserved_objects[i] + ")";
		}
	}
	if(flag){
		dbg_print("%c pass","color:green;");
	} else{
		return [flag,reason];
	}

	return full_evaluate(script);
}


function validateLicense(matches) {
	if (!(Array.isArray(matches) && matches.length >= 4)){
		return [false, "Malformed or unrecognized license tag."];
	}

	let [all, tag, first, second] = matches;

	for (let key in licenses){
		// Match by id on first or second parameter, ignoring case
		if (key.toLowerCase() === first.toLowerCase() ||
			key.toLowerCase() === second.toLowerCase()) {
			return [true, `Recognized license: "${licenses[key]['Name']}" `];
		}
		// Match by link on first parameter (legacy)
		if (licenses[key]["Magnet link"] === first.replace("&amp;","&") ||
		    licenses[key]["URL"] === first.replace("&amp;","&")) {
			return [true, `Recognized license: "${licenses[key]['Name']}".`];
		}
	}
	return [false, `Unrecognized license tag: "${all}"`];
}


/**
*
*	Evaluates the content of a script (license, if it is non-trivial)
*
*	Returns
*	[
*		true (accepted) or false (denied),
*		edited content,
*		reason text
*	]
*/
function license_read(scriptSrc, name, external = false){

	let license = legacy_license_lib.check(scriptSrc);
	if (license){
		return [true, scriptSrc, `Licensed under: ${license}`];
	}
	if (listManager.builtInHashes.has(hash(scriptSrc))){
		return [true, scriptSrc, "Common script known to be free software."];
	}

	let editedSrc = "";
	let uneditedSrc = scriptSrc.trim();
	let reason = uneditedSrc ? "" : "Empty source.";
	let partsDenied = false;
	let partsAccepted = false;

	function checkTriviality(s) {
		if (!s.trim()) {
			return true; // empty, ignore it
		}
		let [trivial, message] = external ?
			[false, "External script with no known license"]
			: evaluate(s, name);
		if (trivial) {
			partsAccepted = true;
			editedSrc += s;
		} else {
			partsDenied = true;
			if (s.startsWith("javascript:"))
				editedSrc += `# LIBREJS BLOCKED: ${message}`;
			else
				editedSrc += `/*\nLIBREJS BLOCKED: ${message}\n*/`;
		}
		reason += `\n${message}`;
		return trivial;
	}

	while (uneditedSrc) {
		let openingMatch = /\/[\/\*]\s*?(@license)\s+(\S+)\s+(\S+)\s*$/mi.exec(uneditedSrc);
		if (!openingMatch) { // no license found, check for triviality
			checkTriviality(uneditedSrc);
			break;
		}

		let openingIndex = openingMatch.index;
		if (openingIndex) {
			// let's check the triviality of the code before the license tag, if any
			checkTriviality(uneditedSrc.substring(0, openingIndex));
		}
		// let's check the actual license
		uneditedSrc = uneditedSrc.substring(openingIndex);

		let closureMatch = /\/([*/])\s*@license-end\b[^*/\n]*/i.exec(uneditedSrc);
		if (!closureMatch) {
			let msg = "ERROR: @license with no @license-end";
			return [false, `\n/*\n ${msg} \n*/\n`, msg];
		}

		let closureEndIndex = closureMatch.index + closureMatch[0].length;
		let commentEndOffset = uneditedSrc.substring(closureEndIndex).indexOf(closureMatch[1] === "*" ? "*/" : "\n");
		if (commentEndOffset !== -1) {
			closureEndIndex += commentEndOffset;
		}

		let [licenseOK, message] = validateLicense(openingMatch);
		if(licenseOK) {
			editedSrc += uneditedSrc.substr(0, closureEndIndex);
			partsAccepted = true;
		} else {
			editedSrc += `\n/*\n${message}\n*/\n`;
			partsDenied = true;
		}
		reason += `\n${message}`;

		// trim off everything we just evaluated
		uneditedSrc = uneditedSrc.substring(closureEndIndex).trim();
	}

	if(partsDenied) {
		if (partsAccepted) {
			reason = `Some parts of the script have been disabled (check the source for details).\n^--- ${reason}`;
		}
		return [false, editedSrc, reason];
	}

	return [true, scriptSrc, reason];
}

/* *********************************************************************************************** */
// TODO: Test if this script is being loaded from another domain compared to activityReports[tabid]["url"]

/**
*	Asynchronous function, returns the final edited script as a string,
* or an array containing it and the index, if the latter !== -1
*/
async function get_script(response, url, tabId = -1, whitelisted = false, index = -1) {
	function result(scriptSource) {
		return index === -1 ? scriptSource : [scriptSource, index];
	}


	let scriptName = url.split("/").pop();
	if (whitelisted) {
		if (tabId !== -1) {
			let site = ListManager.siteMatch(url, whitelist);
			// Accept without reading script, it was explicitly whitelisted
			let reason = site
				? `All ${site} whitelisted by user`
				: "Address whitelisted by user";
			addReportEntry(tabId, url, {"whitelisted": [site || url, reason], url});
		}
		if (response.startsWith("javascript:"))
			return result(response);
		else
			return result(`/* LibreJS: script whitelisted by user preference. */\n${response}`);
	}

	let [verdict, editedSource, reason] = license_read(response, scriptName, index === -2);

	if (tabId < 0) {
		return result(verdict ? response : editedSource);
	}

	let sourceHash = hash(response);
 	let domain = get_domain(url);
	let report = activityReports[tabId] || (activityReports[tabId] = await createReport({tabId}));
	updateBadge(tabId, report, !verdict);
	let category = await addReportEntry(tabId, sourceHash, {"url": domain, [verdict ? "accepted" : "blocked"]: [url, reason]});
	switch(category) {
		case "blacklisted":
			editedSource = `/* LibreJS: script ${category} by user. */`;
			return result(response.startsWith("javascript:")
				? `javascript:void(${encodeURIComponent(editedSource)})` : editedSource);
		case "whitelisted":
			return result(response.startsWith("javascript:")
				? response : `/* LibreJS: script ${category} by user. */\n${response}`);
		default:
			let scriptSource = verdict ? response : editedSource;
      return result(response.startsWith("javascript:")
				? (verdict ? scriptSource : `javascript:void(/* ${scriptSource} */)`)
				: `/* LibreJS: script ${category}. */\n${scriptSource}`
			);
	}
}


function updateBadge(tabId, report = null, forceRed = false) {
	let blockedCount = report ? report.blocked.length + report.blacklisted.length : 0;
	let [text, color] = blockedCount > 0 || forceRed
		? [blockedCount && blockedCount.toString() || "!" , "red"] : ["✓", "green"]
	let {browserAction} = browser;
	if ("setBadgeText" in browserAction) {
		browserAction.setBadgeText({text, tabId});
		browserAction.setBadgeBackgroundColor({color, tabId});
	} else {
		// Mobile
		browserAction.setTitle({title: `LibreJS (${text})`, tabId});
	}
}

function blockGoogleAnalytics(request) {
	let {url} = request;
	let res = {};
	if (url === 'https://www.google-analytics.com/analytics.js' ||
		/^https:\/\/www\.google\.com\/analytics\/[^#]/.test(url)
	) {
		res.cancel = true;
	}
	return res;
}

async function blockBlacklistedScripts(request)  {
	let {url, tabId, documentUrl} = request;
	url = ListStore.urlItem(url);
	let status = listManager.getStatus(url);
	if (status !== "blacklisted") return {};
	let blacklistedSite = ListManager.siteMatch(url, blacklist);
	await addReportEntry(tabId, url, {url: documentUrl,
		"blacklisted": [url, /\*/.test(blacklistedSite) ? `User blacklisted ${blacklistedSite}` : "Blacklisted by user"]});
	return {cancel: true};
}

/**
*	This listener gets called as soon as we've got all the HTTP headers, can guess
* content type and encoding, and therefore correctly parse HTML documents
* and external script inclusions in search of non-free JavaScript
*/

var ResponseHandler = {
	/**
	*	Enforce white/black lists for url/site early (hashes will be handled later)
	*/
	async pre(response) {
		let {request} = response;
		let {url, type, tabId, frameId, documentUrl} = request;

		let fullUrl = url;
		url = ListStore.urlItem(url);
		let site = ListStore.siteItem(url);

		let blacklistedSite = ListManager.siteMatch(site, blacklist);
		let blacklisted = blacklistedSite || blacklist.contains(url);
		let topUrl = type === "sub_frame" && request.frameAncestors && request.frameAncestors.pop() || documentUrl;

		if (blacklisted) {
			if (type === "script") {
				// this shouldn't happen, because we intercept earlier in blockBlacklistedScripts()
				return ResponseProcessor.REJECT;
			}
			if (type === "main_frame") { // we handle the page change here too, since we won't call edit_html()
				activityReports[tabId] = await createReport({url: fullUrl, tabId});
				// Go on without parsing the page: it was explicitly blacklisted
				let reason = blacklistedSite
					? `All ${blacklistedSite} blacklisted by user`
					: "Address blacklisted by user";
				await addReportEntry(tabId, url, {"blacklisted": [blacklistedSite || url, reason], url: fullUrl});
			}
			// use CSP to restrict JavaScript execution in the page
			request.responseHeaders.unshift({
				name: `Content-security-policy`,
				value: `script-src 'none';`
			});
			return {responseHeaders: request.responseHeaders}; // let's skip the inline script parsing, since we block by CSP
		} else {
			let whitelistedSite = ListManager.siteMatch(site, whitelist);
			let whitelisted = response.whitelisted = whitelistedSite || whitelist.contains(url);
			if (type === "script") {
				if (whitelisted) {
					// accept the script and stop processing
					addReportEntry(tabId, url, {url: topUrl,
						"whitelisted": [url, whitelistedSite ? `User whitelisted ${whitelistedSite}` : "Whitelisted by user"]});
					return ResponseProcessor.ACCEPT;
				} else {
					let scriptInfo = await ExternalLicenses.check({url: fullUrl, tabId, frameId, documentUrl});
					if (scriptInfo) {
						let verdict, ret;
						let msg = scriptInfo.toString();
						if (scriptInfo.free) {
							verdict = "accepted";
							ret = ResponseProcessor.ACCEPT;
						} else {
							verdict = "blocked";
							ret = ResponseProcessor.REJECT;
						}
						addReportEntry(tabId, url, {url, [verdict]: [url, msg]});
						return ret;
					}
				}
			}
		}
		// it's a page (it's too early to report) or an unknown script:
		//  let's keep processing
		return ResponseProcessor.CONTINUE;
	},

	/**
	*	Here we do the heavylifting, analyzing unknown scripts
	*/
	async post(response) {
		let {type} = response.request;
		let handle_it = type === "script" ? handle_script : handle_html;
		return await handle_it(response, response.whitelisted);
	}
}

/**
* Here we handle external script requests
*/
async function handle_script(response, whitelisted){
	let {text, request} = response;
	let {url, tabId, frameId} = request;
	url = ListStore.urlItem(url);
  let edited = await get_script(text, url, tabId, whitelisted, -2);
	return Array.isArray(edited) ? edited[0] : edited;
}

/**
* Serializes HTMLDocument objects including the root element and
*	the DOCTYPE declaration
*/
function doc2HTML(doc) {
	let s = doc.documentElement.outerHTML;
	if (doc.doctype) {
		let dt = doc.doctype;
		let sDoctype = `<!DOCTYPE ${dt.name || "html"}`;
		if (dt.publicId) sDoctype += ` PUBLIC "${dt.publicId}"`;
		if (dt.systemId) sDoctype += ` "${dt.systemId}"`;
		s = `${sDoctype}>\n${s}`;
	}
	return s;
}

/**
* Shortcut to create a correctly namespaced DOM HTML elements
*/
function createHTMLElement(doc, name) {
  return doc.createElementNS("http://www.w3.org/1999/xhtml", name);
}

/**
* Replace any element with a span having the same content (useful to force
* NOSCRIPT elements to visible the same way as NoScript and uBlock do)
*/
function forceElement(doc, element) {
	let replacement = createHTMLElement(doc, "span");
	replacement.innerHTML = element.innerHTML;
	element.replaceWith(replacement);
	return replacement;
}

/**
*	Forces displaying any element having the "data-librejs-display" attribute and
* <noscript> elements on pages where LibreJS disabled inline scripts (unless
* they have the "data-librejs-nodisplay" attribute).
*/
function forceNoscriptElements(doc) {
	let shown = 0;
	// inspired by NoScript's onScriptDisabled.js
	for (let noscript of doc.querySelectorAll("noscript:not([data-librejs-nodisplay])")) {
    let replacement = forceElement(doc, noscript);
    // emulate meta-refresh
    let meta = replacement.querySelector('meta[http-equiv="refresh"]');
    if (meta) {
      refresh = true;
      doc.head.appendChild(meta);
    }
		shown++;
  }
	return shown;
}
/**
*	Forces displaying any element having the "data-librejs-display" attribute and
* <noscript> elements on pages where LibreJS disabled inline scripts (unless
* they have the "data-librejs-nodisplay" attribute).
*/
function showConditionalElements(doc) {
	let shown = 0;
	for (let element of document.querySelectorAll("[data-librejs-display]")) {
		forceElement(doc, element);
		shown++;
	}
	return shown;
}

/**
*	Tests to see if the intrinsic events on the page are free or not.
*	returns true if they are, false if they're not
*/
function read_metadata(meta_element){

		if(meta_element === undefined || meta_element === null){
			return;
		}

		console.log("metadata found");

		var metadata = {};

		try{
			metadata = JSON.parse(meta_element.innerHTML);
		}catch(error){
			console.log("Could not parse metadata on page.")
			return false;
		}

		var license_str = metadata["intrinsic-events"];
		if(license_str === undefined){
			console.log("No intrinsic events license");
			return false;
		}
		console.log(license_str);

		var parts = license_str.split(" ");
		if(parts.length != 2){
			console.log("invalid (>2 tokens)");
			return false;
		}

		// this should be adequete to escape the HTML escaping
		parts[0] = parts[0].replace(/&amp;/g, '&');

		try{
			if(licenses[parts[1]]["Magnet link"] == parts[0]){
				return true;
			}else{
				console.log("invalid (doesn't match licenses)");
				return false;
			}
		} catch(error){
			console.log("invalid (threw error, key didn't exist)");
			return false;
		}
}
/**

* 	Reads/changes the HTML of a page and the scripts within it.
*/
async function editHtml(html, documentUrl, tabId, frameId, whitelisted){

	var parser = new DOMParser();
	var html_doc = parser.parseFromString(html, "text/html");

	// moves external licenses reference, if any, before any <SCRIPT> element
	ExternalLicenses.optimizeDocument(html_doc, {tabId, frameId, documentUrl});

	let url = ListStore.urlItem(documentUrl);

	if (whitelisted) { // don't bother rewriting
		await get_script(html, url, tabId, whitelisted); // generates whitelisted report
		return null;
	}

	var scripts = html_doc.scripts;

	var meta_element = html_doc.getElementById("LibreJS-info");
	var first_script_src = "";

	// get the potential inline source that can contain a license
	for (let script of scripts) {
		// The script must be in-line and exist
		if(script && !script.src) {
			first_script_src = script.textContent;
			break;
		}
	}

	let license = false;
	if (first_script_src != "") {
		license = legacy_license_lib.check(first_script_src);
	}

	let findLine = finder => finder.test(html) && html.substring(0, finder.lastIndex).split(/\n/).length || 0;
	if (read_metadata(meta_element) || license) {
		console.log("Valid license for intrinsic events found");
		let line, extras;
		if (meta_element) {
		  line = findLine(/id\s*=\s*['"]?LibreJS-info\b/gi);
			extras = "(0)";
		} else if (license) {
			line = html.substring(0, html.indexOf(first_script_src)).split(/\n/).length;
			extras = "\n" + first_script_src;
		}
		let viewUrl = line ? `view-source:${documentUrl}#line${line}(<${meta_element ? meta_element.tagName : "SCRIPT"}>)${extras}` : url;
		addReportEntry(tabId, url, {url, "accepted":[viewUrl, `Global license for the page: ${license}`]});
		// Do not process inline scripts
		scripts = [];
	} else {
		let dejaVu = new Map(); // deduplication map & edited script cache
		let modified = false;
		// Deal with intrinsic events
		let intrinsecindex = 0;
		let intrinsicFinder = /<[a-z][^>]*\b(on\w+|href\s*=\s*['"]?javascript:)/gi;
		for (let element of html_doc.all) {
			let line = -1;
			for (let attr of element.attributes) {
				let {name, value} = attr;
				value = value.trim();
				if (name.startsWith("on") || (name === "href" && value.toLowerCase().startsWith("javascript:"))){
					intrinsecindex++;
					if (line === -1) {
						line = findLine(intrinsicFinder);
					}
					try {
						let key = `<${element.tagName} ${name}="${value}">`;
						let edited;
						if (dejaVu.has(key)) {
							edited = dejaVu.get(key);
						} else {
							let url = `view-source:${documentUrl}#line${line}(<${element.tagName} ${name}>)\n${value.trim()}`;
							if (name === "href") value = decodeURIComponent(value);
							edited = await get_script(value, url, tabId, whitelist.contains(url));						dejaVu.set(key, edited);
						}
						if (edited && edited !== value) {
							modified = true;
							attr.value = edited;
						}
					} catch (e) {
						console.error(e);
					}
				}
			}
		}

		let modifiedInline = false;
		let scriptFinder = /<script\b/ig;
		for(let i = 0, len = scripts.length; i < len; i++) {
			let script = scripts[i];
			let line = findLine(scriptFinder);
			if (!script.src && !(script.type && script.type !== "text/javascript")) {
				let source = script.textContent.trim();
				let editedSource;
				if (dejaVu.has(source)) {
					editedSource = dejaVu.get(source);
				} else {
					let url = `view-source:${documentUrl}#line${line}(<SCRIPT>)\n${source}`;
					let edited = await get_script(source, url, tabId, whitelisted, i);
					editedSource = edited && edited[0].trim();
					dejaVu.set(url, editedSource);
				}
				if (editedSource) {
					if (source !== editedSource) {
						script.textContent = editedSource;
						modified = modifiedInline = true;
					}
				}
			}
		}

		modified = showConditionalElements(html_doc) > 0 || modified;
		if (modified) {
			if (modifiedInline) {
				forceNoscriptElements(html_doc);
			}
			return doc2HTML(html_doc);
		}
	}
	return null;
}

/**
* Here we handle html document responses
*/
async function handle_html(response, whitelisted) {
	let {text, request} = response;
	let {url, tabId, frameId, type} = request;
	if (type === "main_frame") {
		activityReports[tabId] = await createReport({url, tabId});
		updateBadge(tabId);
	}
	return await editHtml(text, url, tabId, frameId, whitelisted);
}

var whitelist = new ListStore("pref_whitelist", Storage.CSV);
var blacklist = new ListStore("pref_blacklist", Storage.CSV);
var listManager = new ListManager(whitelist, blacklist,
		// built-in whitelist of script hashes, e.g. jQuery
		Object.values(require("./hash_script/whitelist").whitelist)
			.reduce((a, b) => a.concat(b)) // as a flat array
			.map(script => script.hash)
	);


async function initDefaults() {
	let defaults = {
		pref_subject: "Issues with Javascript on your website",
		pref_body: `Please consider using a free license for the Javascript on your website.

[Message generated by LibreJS. See https://www.gnu.org/software/librejs/ for more information]
`
	};
	let keys = Object.keys(defaults);
	let prefs = await browser.storage.local.get(keys);
	let changed = false;
	for (let k of keys) {
		if (!(k in prefs)) {
			prefs[k] = defaults[k];
			changed = true;
		}
	}
	if (changed) {
		await browser.storage.local.set(prefs);
	}
}

/**
*	Initializes various add-on functions
*	only meant to be called once when the script starts
*/
async function init_addon() {
	await initDefaults();
	await whitelist.load();
	browser.runtime.onConnect.addListener(connected);
	browser.storage.onChanged.addListener(options_listener);
	browser.tabs.onRemoved.addListener(delete_removed_tab_info);
	browser.tabs.onUpdated.addListener(onTabUpdated);
	browser.tabs.onActivated.addListener(onTabActivated);
	// Prevents Google Analytics from being loaded from Google servers
	let all_types = [
		"beacon", "csp_report", "font", "image", "imageset", "main_frame", "media",
		"object", "object_subrequest", "ping", "script", "stylesheet", "sub_frame",
		"web_manifest", "websocket", "xbl", "xml_dtd", "xmlhttprequest", "xslt",
		"other"
	];
	browser.webRequest.onBeforeRequest.addListener(blockGoogleAnalytics,
		{urls: ["<all_urls>"], types: all_types},
		["blocking"]
	);
	browser.webRequest.onBeforeRequest.addListener(blockBlacklistedScripts,
		{urls: ["<all_urls>"], types: ["script"]},
		["blocking"]
	);
	browser.webRequest.onResponseStarted.addListener(request => {
		let {tabId} = request;
		let report = activityReports[tabId];
		if (report) {
			updateBadge(tabId, activityReports[tabId]);
		}
	}, {urls: ["<all_urls>"], types: ["main_frame"]});

	// Analyzes all the html documents and external scripts as they're loaded
	ResponseProcessor.install(ResponseHandler);

	legacy_license_lib.init();


	let Test = require("./common/Test");
	if (Test.getURL()) {
		// export testable functions to the global scope
		this.LibreJS = {
			editHtml,
			handle_script,
			ExternalLicenses,
			ListManager, ListStore, Storage,
		};
		// create or focus the autotest tab if it's a debugging session
		if ((await browser.management.getSelf()).installType === "development") {
			Test.getTab(true);
		}
	}
}


/**
*	Loads the contact finder on the given tab ID.
*/
async function injectContactFinder(tabId){
	await Promise.all([
		browser.tabs.insertCSS(tabId, {file: "/content/overlay.css", cssOrigin: "user"}),
		browser.tabs.executeScript(tabId, {file: "/content/contactFinder.js"}),
 ]);
}

init_addon();

},{"./bg/ExternalLicenses":1,"./bg/ListManager":2,"./bg/ResponseProcessor":4,"./common/Storage":5,"./common/Test":6,"./fname_data.json":7,"./hash_script/whitelist":8,"./legacy_license_check.js":9,"./licenses.json":11,"acorn":15,"acorn-loose":13}],13:[function(require,module,exports){
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('acorn')) :
	typeof define === 'function' && define.amd ? define(['exports', 'acorn'], factory) :
	(factory((global.acorn = global.acorn || {}, global.acorn.loose = {}),global.acorn));
}(this, (function (exports,acorn) { 'use strict';

function noop() {}

var LooseParser = function LooseParser(input, options) {
  if ( options === void 0 ) options = {};

  this.toks = this.constructor.BaseParser.tokenizer(input, options);
  this.options = this.toks.options;
  this.input = this.toks.input;
  this.tok = this.last = {type: acorn.tokTypes.eof, start: 0, end: 0};
  this.tok.validateRegExpFlags = noop;
  this.tok.validateRegExpPattern = noop;
  if (this.options.locations) {
    var here = this.toks.curPosition();
    this.tok.loc = new acorn.SourceLocation(this.toks, here, here);
  }
  this.ahead = []; // Tokens ahead
  this.context = []; // Indentation contexted
  this.curIndent = 0;
  this.curLineStart = 0;
  this.nextLineStart = this.lineEnd(this.curLineStart) + 1;
  this.inAsync = false;
  this.inFunction = false;
};

LooseParser.prototype.startNode = function startNode () {
  return new acorn.Node(this.toks, this.tok.start, this.options.locations ? this.tok.loc.start : null)
};

LooseParser.prototype.storeCurrentPos = function storeCurrentPos () {
  return this.options.locations ? [this.tok.start, this.tok.loc.start] : this.tok.start
};

LooseParser.prototype.startNodeAt = function startNodeAt (pos) {
  if (this.options.locations) {
    return new acorn.Node(this.toks, pos[0], pos[1])
  } else {
    return new acorn.Node(this.toks, pos)
  }
};

LooseParser.prototype.finishNode = function finishNode (node, type) {
  node.type = type;
  node.end = this.last.end;
  if (this.options.locations)
    { node.loc.end = this.last.loc.end; }
  if (this.options.ranges)
    { node.range[1] = this.last.end; }
  return node
};

LooseParser.prototype.dummyNode = function dummyNode (type) {
  var dummy = this.startNode();
  dummy.type = type;
  dummy.end = dummy.start;
  if (this.options.locations)
    { dummy.loc.end = dummy.loc.start; }
  if (this.options.ranges)
    { dummy.range[1] = dummy.start; }
  this.last = {type: acorn.tokTypes.name, start: dummy.start, end: dummy.start, loc: dummy.loc};
  return dummy
};

LooseParser.prototype.dummyIdent = function dummyIdent () {
  var dummy = this.dummyNode("Identifier");
  dummy.name = "✖";
  return dummy
};

LooseParser.prototype.dummyString = function dummyString () {
  var dummy = this.dummyNode("Literal");
  dummy.value = dummy.raw = "✖";
  return dummy
};

LooseParser.prototype.eat = function eat (type) {
  if (this.tok.type === type) {
    this.next();
    return true
  } else {
    return false
  }
};

LooseParser.prototype.isContextual = function isContextual (name) {
  return this.tok.type === acorn.tokTypes.name && this.tok.value === name
};

LooseParser.prototype.eatContextual = function eatContextual (name) {
  return this.tok.value === name && this.eat(acorn.tokTypes.name)
};

LooseParser.prototype.canInsertSemicolon = function canInsertSemicolon () {
  return this.tok.type === acorn.tokTypes.eof || this.tok.type === acorn.tokTypes.braceR ||
    acorn.lineBreak.test(this.input.slice(this.last.end, this.tok.start))
};

LooseParser.prototype.semicolon = function semicolon () {
  return this.eat(acorn.tokTypes.semi)
};

LooseParser.prototype.expect = function expect (type) {
    var this$1 = this;

  if (this.eat(type)) { return true }
  for (var i = 1; i <= 2; i++) {
    if (this$1.lookAhead(i).type === type) {
      for (var j = 0; j < i; j++) { this$1.next(); }
      return true
    }
  }
};

LooseParser.prototype.pushCx = function pushCx () {
  this.context.push(this.curIndent);
};

LooseParser.prototype.popCx = function popCx () {
  this.curIndent = this.context.pop();
};

LooseParser.prototype.lineEnd = function lineEnd (pos) {
  while (pos < this.input.length && !acorn.isNewLine(this.input.charCodeAt(pos))) { ++pos; }
  return pos
};

LooseParser.prototype.indentationAfter = function indentationAfter (pos) {
    var this$1 = this;

  for (var count = 0;; ++pos) {
    var ch = this$1.input.charCodeAt(pos);
    if (ch === 32) { ++count; }
    else if (ch === 9) { count += this$1.options.tabSize; }
    else { return count }
  }
};

LooseParser.prototype.closes = function closes (closeTok, indent, line, blockHeuristic) {
  if (this.tok.type === closeTok || this.tok.type === acorn.tokTypes.eof) { return true }
  return line !== this.curLineStart && this.curIndent < indent && this.tokenStartsLine() &&
    (!blockHeuristic || this.nextLineStart >= this.input.length ||
     this.indentationAfter(this.nextLineStart) < indent)
};

LooseParser.prototype.tokenStartsLine = function tokenStartsLine () {
    var this$1 = this;

  for (var p = this.tok.start - 1; p >= this.curLineStart; --p) {
    var ch = this$1.input.charCodeAt(p);
    if (ch !== 9 && ch !== 32) { return false }
  }
  return true
};

LooseParser.prototype.extend = function extend (name, f) {
  this[name] = f(this[name]);
};

LooseParser.prototype.parse = function parse () {
  this.next();
  return this.parseTopLevel()
};

LooseParser.extend = function extend () {
    var plugins = [], len = arguments.length;
    while ( len-- ) plugins[ len ] = arguments[ len ];

  var cls = this;
  for (var i = 0; i < plugins.length; i++) { cls = plugins[i](cls); }
  return cls
};

LooseParser.parse = function parse (input, options) {
  return new this(input, options).parse()
};

// Allows plugins to extend the base parser / tokenizer used
LooseParser.BaseParser = acorn.Parser;

var lp = LooseParser.prototype;

function isSpace(ch) {
  return (ch < 14 && ch > 8) || ch === 32 || ch === 160 || acorn.isNewLine(ch)
}

lp.next = function() {
  var this$1 = this;

  this.last = this.tok;
  if (this.ahead.length)
    { this.tok = this.ahead.shift(); }
  else
    { this.tok = this.readToken(); }

  if (this.tok.start >= this.nextLineStart) {
    while (this.tok.start >= this.nextLineStart) {
      this$1.curLineStart = this$1.nextLineStart;
      this$1.nextLineStart = this$1.lineEnd(this$1.curLineStart) + 1;
    }
    this.curIndent = this.indentationAfter(this.curLineStart);
  }
};

lp.readToken = function() {
  var this$1 = this;

  for (;;) {
    try {
      this$1.toks.next();
      if (this$1.toks.type === acorn.tokTypes.dot &&
          this$1.input.substr(this$1.toks.end, 1) === "." &&
          this$1.options.ecmaVersion >= 6) {
        this$1.toks.end++;
        this$1.toks.type = acorn.tokTypes.ellipsis;
      }
      return new acorn.Token(this$1.toks)
    } catch (e) {
      if (!(e instanceof SyntaxError)) { throw e }

      // Try to skip some text, based on the error message, and then continue
      var msg = e.message, pos = e.raisedAt, replace = true;
      if (/unterminated/i.test(msg)) {
        pos = this$1.lineEnd(e.pos + 1);
        if (/string/.test(msg)) {
          replace = {start: e.pos, end: pos, type: acorn.tokTypes.string, value: this$1.input.slice(e.pos + 1, pos)};
        } else if (/regular expr/i.test(msg)) {
          var re = this$1.input.slice(e.pos, pos);
          try { re = new RegExp(re); } catch (e) { /* ignore compilation error due to new syntax */ }
          replace = {start: e.pos, end: pos, type: acorn.tokTypes.regexp, value: re};
        } else if (/template/.test(msg)) {
          replace = {
            start: e.pos,
            end: pos,
            type: acorn.tokTypes.template,
            value: this$1.input.slice(e.pos, pos)
          };
        } else {
          replace = false;
        }
      } else if (/invalid (unicode|regexp|number)|expecting unicode|octal literal|is reserved|directly after number|expected number in radix/i.test(msg)) {
        while (pos < this.input.length && !isSpace(this.input.charCodeAt(pos))) { ++pos; }
      } else if (/character escape|expected hexadecimal/i.test(msg)) {
        while (pos < this.input.length) {
          var ch = this$1.input.charCodeAt(pos++);
          if (ch === 34 || ch === 39 || acorn.isNewLine(ch)) { break }
        }
      } else if (/unexpected character/i.test(msg)) {
        pos++;
        replace = false;
      } else if (/regular expression/i.test(msg)) {
        replace = true;
      } else {
        throw e
      }
      this$1.resetTo(pos);
      if (replace === true) { replace = {start: pos, end: pos, type: acorn.tokTypes.name, value: "✖"}; }
      if (replace) {
        if (this$1.options.locations)
          { replace.loc = new acorn.SourceLocation(
            this$1.toks,
            acorn.getLineInfo(this$1.input, replace.start),
            acorn.getLineInfo(this$1.input, replace.end)); }
        return replace
      }
    }
  }
};

lp.resetTo = function(pos) {
  var this$1 = this;

  this.toks.pos = pos;
  var ch = this.input.charAt(pos - 1);
  this.toks.exprAllowed = !ch || /[[{(,;:?/*=+\-~!|&%^<>]/.test(ch) ||
    /[enwfd]/.test(ch) &&
    /\b(case|else|return|throw|new|in|(instance|type)?of|delete|void)$/.test(this.input.slice(pos - 10, pos));

  if (this.options.locations) {
    this.toks.curLine = 1;
    this.toks.lineStart = acorn.lineBreakG.lastIndex = 0;
    var match;
    while ((match = acorn.lineBreakG.exec(this.input)) && match.index < pos) {
      ++this$1.toks.curLine;
      this$1.toks.lineStart = match.index + match[0].length;
    }
  }
};

lp.lookAhead = function(n) {
  var this$1 = this;

  while (n > this.ahead.length)
    { this$1.ahead.push(this$1.readToken()); }
  return this.ahead[n - 1]
};

function isDummy(node) { return node.name === "✖" }

var lp$1 = LooseParser.prototype;

lp$1.parseTopLevel = function() {
  var this$1 = this;

  var node = this.startNodeAt(this.options.locations ? [0, acorn.getLineInfo(this.input, 0)] : 0);
  node.body = [];
  while (this.tok.type !== acorn.tokTypes.eof) { node.body.push(this$1.parseStatement()); }
  this.toks.adaptDirectivePrologue(node.body);
  this.last = this.tok;
  if (this.options.ecmaVersion >= 6) {
    node.sourceType = this.options.sourceType;
  }
  return this.finishNode(node, "Program")
};

lp$1.parseStatement = function() {
  var this$1 = this;

  var starttype = this.tok.type, node = this.startNode(), kind;

  if (this.toks.isLet()) {
    starttype = acorn.tokTypes._var;
    kind = "let";
  }

  switch (starttype) {
  case acorn.tokTypes._break: case acorn.tokTypes._continue:
    this.next();
    var isBreak = starttype === acorn.tokTypes._break;
    if (this.semicolon() || this.canInsertSemicolon()) {
      node.label = null;
    } else {
      node.label = this.tok.type === acorn.tokTypes.name ? this.parseIdent() : null;
      this.semicolon();
    }
    return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement")

  case acorn.tokTypes._debugger:
    this.next();
    this.semicolon();
    return this.finishNode(node, "DebuggerStatement")

  case acorn.tokTypes._do:
    this.next();
    node.body = this.parseStatement();
    node.test = this.eat(acorn.tokTypes._while) ? this.parseParenExpression() : this.dummyIdent();
    this.semicolon();
    return this.finishNode(node, "DoWhileStatement")

  case acorn.tokTypes._for:
    this.next(); // `for` keyword
    var isAwait = this.options.ecmaVersion >= 9 && this.inAsync && this.eatContextual("await");

    this.pushCx();
    this.expect(acorn.tokTypes.parenL);
    if (this.tok.type === acorn.tokTypes.semi) { return this.parseFor(node, null) }
    var isLet = this.toks.isLet();
    if (isLet || this.tok.type === acorn.tokTypes._var || this.tok.type === acorn.tokTypes._const) {
      var init$1 = this.parseVar(this.startNode(), true, isLet ? "let" : this.tok.value);
      if (init$1.declarations.length === 1 && (this.tok.type === acorn.tokTypes._in || this.isContextual("of"))) {
        if (this.options.ecmaVersion >= 9 && this.tok.type !== acorn.tokTypes._in) {
          node.await = isAwait;
        }
        return this.parseForIn(node, init$1)
      }
      return this.parseFor(node, init$1)
    }
    var init = this.parseExpression(true);
    if (this.tok.type === acorn.tokTypes._in || this.isContextual("of")) {
      if (this.options.ecmaVersion >= 9 && this.tok.type !== acorn.tokTypes._in) {
        node.await = isAwait;
      }
      return this.parseForIn(node, this.toAssignable(init))
    }
    return this.parseFor(node, init)

  case acorn.tokTypes._function:
    this.next();
    return this.parseFunction(node, true)

  case acorn.tokTypes._if:
    this.next();
    node.test = this.parseParenExpression();
    node.consequent = this.parseStatement();
    node.alternate = this.eat(acorn.tokTypes._else) ? this.parseStatement() : null;
    return this.finishNode(node, "IfStatement")

  case acorn.tokTypes._return:
    this.next();
    if (this.eat(acorn.tokTypes.semi) || this.canInsertSemicolon()) { node.argument = null; }
    else { node.argument = this.parseExpression(); this.semicolon(); }
    return this.finishNode(node, "ReturnStatement")

  case acorn.tokTypes._switch:
    var blockIndent = this.curIndent, line = this.curLineStart;
    this.next();
    node.discriminant = this.parseParenExpression();
    node.cases = [];
    this.pushCx();
    this.expect(acorn.tokTypes.braceL);

    var cur;
    while (!this.closes(acorn.tokTypes.braceR, blockIndent, line, true)) {
      if (this$1.tok.type === acorn.tokTypes._case || this$1.tok.type === acorn.tokTypes._default) {
        var isCase = this$1.tok.type === acorn.tokTypes._case;
        if (cur) { this$1.finishNode(cur, "SwitchCase"); }
        node.cases.push(cur = this$1.startNode());
        cur.consequent = [];
        this$1.next();
        if (isCase) { cur.test = this$1.parseExpression(); }
        else { cur.test = null; }
        this$1.expect(acorn.tokTypes.colon);
      } else {
        if (!cur) {
          node.cases.push(cur = this$1.startNode());
          cur.consequent = [];
          cur.test = null;
        }
        cur.consequent.push(this$1.parseStatement());
      }
    }
    if (cur) { this.finishNode(cur, "SwitchCase"); }
    this.popCx();
    this.eat(acorn.tokTypes.braceR);
    return this.finishNode(node, "SwitchStatement")

  case acorn.tokTypes._throw:
    this.next();
    node.argument = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, "ThrowStatement")

  case acorn.tokTypes._try:
    this.next();
    node.block = this.parseBlock();
    node.handler = null;
    if (this.tok.type === acorn.tokTypes._catch) {
      var clause = this.startNode();
      this.next();
      if (this.eat(acorn.tokTypes.parenL)) {
        clause.param = this.toAssignable(this.parseExprAtom(), true);
        this.expect(acorn.tokTypes.parenR);
      } else {
        clause.param = null;
      }
      clause.body = this.parseBlock();
      node.handler = this.finishNode(clause, "CatchClause");
    }
    node.finalizer = this.eat(acorn.tokTypes._finally) ? this.parseBlock() : null;
    if (!node.handler && !node.finalizer) { return node.block }
    return this.finishNode(node, "TryStatement")

  case acorn.tokTypes._var:
  case acorn.tokTypes._const:
    return this.parseVar(node, false, kind || this.tok.value)

  case acorn.tokTypes._while:
    this.next();
    node.test = this.parseParenExpression();
    node.body = this.parseStatement();
    return this.finishNode(node, "WhileStatement")

  case acorn.tokTypes._with:
    this.next();
    node.object = this.parseParenExpression();
    node.body = this.parseStatement();
    return this.finishNode(node, "WithStatement")

  case acorn.tokTypes.braceL:
    return this.parseBlock()

  case acorn.tokTypes.semi:
    this.next();
    return this.finishNode(node, "EmptyStatement")

  case acorn.tokTypes._class:
    return this.parseClass(true)

  case acorn.tokTypes._import:
    return this.parseImport()

  case acorn.tokTypes._export:
    return this.parseExport()

  default:
    if (this.toks.isAsyncFunction()) {
      this.next();
      this.next();
      return this.parseFunction(node, true, true)
    }
    var expr = this.parseExpression();
    if (isDummy(expr)) {
      this.next();
      if (this.tok.type === acorn.tokTypes.eof) { return this.finishNode(node, "EmptyStatement") }
      return this.parseStatement()
    } else if (starttype === acorn.tokTypes.name && expr.type === "Identifier" && this.eat(acorn.tokTypes.colon)) {
      node.body = this.parseStatement();
      node.label = expr;
      return this.finishNode(node, "LabeledStatement")
    } else {
      node.expression = expr;
      this.semicolon();
      return this.finishNode(node, "ExpressionStatement")
    }
  }
};

lp$1.parseBlock = function() {
  var this$1 = this;

  var node = this.startNode();
  this.pushCx();
  this.expect(acorn.tokTypes.braceL);
  var blockIndent = this.curIndent, line = this.curLineStart;
  node.body = [];
  while (!this.closes(acorn.tokTypes.braceR, blockIndent, line, true))
    { node.body.push(this$1.parseStatement()); }
  this.popCx();
  this.eat(acorn.tokTypes.braceR);
  return this.finishNode(node, "BlockStatement")
};

lp$1.parseFor = function(node, init) {
  node.init = init;
  node.test = node.update = null;
  if (this.eat(acorn.tokTypes.semi) && this.tok.type !== acorn.tokTypes.semi) { node.test = this.parseExpression(); }
  if (this.eat(acorn.tokTypes.semi) && this.tok.type !== acorn.tokTypes.parenR) { node.update = this.parseExpression(); }
  this.popCx();
  this.expect(acorn.tokTypes.parenR);
  node.body = this.parseStatement();
  return this.finishNode(node, "ForStatement")
};

lp$1.parseForIn = function(node, init) {
  var type = this.tok.type === acorn.tokTypes._in ? "ForInStatement" : "ForOfStatement";
  this.next();
  node.left = init;
  node.right = this.parseExpression();
  this.popCx();
  this.expect(acorn.tokTypes.parenR);
  node.body = this.parseStatement();
  return this.finishNode(node, type)
};

lp$1.parseVar = function(node, noIn, kind) {
  var this$1 = this;

  node.kind = kind;
  this.next();
  node.declarations = [];
  do {
    var decl = this$1.startNode();
    decl.id = this$1.options.ecmaVersion >= 6 ? this$1.toAssignable(this$1.parseExprAtom(), true) : this$1.parseIdent();
    decl.init = this$1.eat(acorn.tokTypes.eq) ? this$1.parseMaybeAssign(noIn) : null;
    node.declarations.push(this$1.finishNode(decl, "VariableDeclarator"));
  } while (this.eat(acorn.tokTypes.comma))
  if (!node.declarations.length) {
    var decl$1 = this.startNode();
    decl$1.id = this.dummyIdent();
    node.declarations.push(this.finishNode(decl$1, "VariableDeclarator"));
  }
  if (!noIn) { this.semicolon(); }
  return this.finishNode(node, "VariableDeclaration")
};

lp$1.parseClass = function(isStatement) {
  var this$1 = this;

  var node = this.startNode();
  this.next();
  if (this.tok.type === acorn.tokTypes.name) { node.id = this.parseIdent(); }
  else if (isStatement === true) { node.id = this.dummyIdent(); }
  else { node.id = null; }
  node.superClass = this.eat(acorn.tokTypes._extends) ? this.parseExpression() : null;
  node.body = this.startNode();
  node.body.body = [];
  this.pushCx();
  var indent = this.curIndent + 1, line = this.curLineStart;
  this.eat(acorn.tokTypes.braceL);
  if (this.curIndent + 1 < indent) { indent = this.curIndent; line = this.curLineStart; }
  while (!this.closes(acorn.tokTypes.braceR, indent, line)) {
    if (this$1.semicolon()) { continue }
    var method = this$1.startNode(), isGenerator = (void 0), isAsync = (void 0);
    if (this$1.options.ecmaVersion >= 6) {
      method.static = false;
      isGenerator = this$1.eat(acorn.tokTypes.star);
    }
    this$1.parsePropertyName(method);
    if (isDummy(method.key)) { if (isDummy(this$1.parseMaybeAssign())) { this$1.next(); } this$1.eat(acorn.tokTypes.comma); continue }
    if (method.key.type === "Identifier" && !method.computed && method.key.name === "static" &&
        (this$1.tok.type !== acorn.tokTypes.parenL && this$1.tok.type !== acorn.tokTypes.braceL)) {
      method.static = true;
      isGenerator = this$1.eat(acorn.tokTypes.star);
      this$1.parsePropertyName(method);
    } else {
      method.static = false;
    }
    if (!method.computed &&
        method.key.type === "Identifier" && method.key.name === "async" && this$1.tok.type !== acorn.tokTypes.parenL &&
        !this$1.canInsertSemicolon()) {
      isAsync = true;
      isGenerator = this$1.options.ecmaVersion >= 9 && this$1.eat(acorn.tokTypes.star);
      this$1.parsePropertyName(method);
    } else {
      isAsync = false;
    }
    if (this$1.options.ecmaVersion >= 5 && method.key.type === "Identifier" &&
        !method.computed && (method.key.name === "get" || method.key.name === "set") &&
        this$1.tok.type !== acorn.tokTypes.parenL && this$1.tok.type !== acorn.tokTypes.braceL) {
      method.kind = method.key.name;
      this$1.parsePropertyName(method);
      method.value = this$1.parseMethod(false);
    } else {
      if (!method.computed && !method.static && !isGenerator && !isAsync && (
        method.key.type === "Identifier" && method.key.name === "constructor" ||
          method.key.type === "Literal" && method.key.value === "constructor")) {
        method.kind = "constructor";
      } else {
        method.kind = "method";
      }
      method.value = this$1.parseMethod(isGenerator, isAsync);
    }
    node.body.body.push(this$1.finishNode(method, "MethodDefinition"));
  }
  this.popCx();
  if (!this.eat(acorn.tokTypes.braceR)) {
    // If there is no closing brace, make the node span to the start
    // of the next token (this is useful for Tern)
    this.last.end = this.tok.start;
    if (this.options.locations) { this.last.loc.end = this.tok.loc.start; }
  }
  this.semicolon();
  this.finishNode(node.body, "ClassBody");
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression")
};

lp$1.parseFunction = function(node, isStatement, isAsync) {
  var oldInAsync = this.inAsync, oldInFunction = this.inFunction;
  this.initFunction(node);
  if (this.options.ecmaVersion >= 6) {
    node.generator = this.eat(acorn.tokTypes.star);
  }
  if (this.options.ecmaVersion >= 8) {
    node.async = !!isAsync;
  }
  if (this.tok.type === acorn.tokTypes.name) { node.id = this.parseIdent(); }
  else if (isStatement === true) { node.id = this.dummyIdent(); }
  this.inAsync = node.async;
  this.inFunction = true;
  node.params = this.parseFunctionParams();
  node.body = this.parseBlock();
  this.toks.adaptDirectivePrologue(node.body.body);
  this.inAsync = oldInAsync;
  this.inFunction = oldInFunction;
  return this.finishNode(node, isStatement ? "FunctionDeclaration" : "FunctionExpression")
};

lp$1.parseExport = function() {
  var node = this.startNode();
  this.next();
  if (this.eat(acorn.tokTypes.star)) {
    node.source = this.eatContextual("from") ? this.parseExprAtom() : this.dummyString();
    return this.finishNode(node, "ExportAllDeclaration")
  }
  if (this.eat(acorn.tokTypes._default)) {
    // export default (function foo() {}) // This is FunctionExpression.
    var isAsync;
    if (this.tok.type === acorn.tokTypes._function || (isAsync = this.toks.isAsyncFunction())) {
      var fNode = this.startNode();
      this.next();
      if (isAsync) { this.next(); }
      node.declaration = this.parseFunction(fNode, "nullableID", isAsync);
    } else if (this.tok.type === acorn.tokTypes._class) {
      node.declaration = this.parseClass("nullableID");
    } else {
      node.declaration = this.parseMaybeAssign();
      this.semicolon();
    }
    return this.finishNode(node, "ExportDefaultDeclaration")
  }
  if (this.tok.type.keyword || this.toks.isLet() || this.toks.isAsyncFunction()) {
    node.declaration = this.parseStatement();
    node.specifiers = [];
    node.source = null;
  } else {
    node.declaration = null;
    node.specifiers = this.parseExportSpecifierList();
    node.source = this.eatContextual("from") ? this.parseExprAtom() : null;
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration")
};

lp$1.parseImport = function() {
  var node = this.startNode();
  this.next();
  if (this.tok.type === acorn.tokTypes.string) {
    node.specifiers = [];
    node.source = this.parseExprAtom();
  } else {
    var elt;
    if (this.tok.type === acorn.tokTypes.name && this.tok.value !== "from") {
      elt = this.startNode();
      elt.local = this.parseIdent();
      this.finishNode(elt, "ImportDefaultSpecifier");
      this.eat(acorn.tokTypes.comma);
    }
    node.specifiers = this.parseImportSpecifiers();
    node.source = this.eatContextual("from") && this.tok.type === acorn.tokTypes.string ? this.parseExprAtom() : this.dummyString();
    if (elt) { node.specifiers.unshift(elt); }
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration")
};

lp$1.parseImportSpecifiers = function() {
  var this$1 = this;

  var elts = [];
  if (this.tok.type === acorn.tokTypes.star) {
    var elt = this.startNode();
    this.next();
    elt.local = this.eatContextual("as") ? this.parseIdent() : this.dummyIdent();
    elts.push(this.finishNode(elt, "ImportNamespaceSpecifier"));
  } else {
    var indent = this.curIndent, line = this.curLineStart, continuedLine = this.nextLineStart;
    this.pushCx();
    this.eat(acorn.tokTypes.braceL);
    if (this.curLineStart > continuedLine) { continuedLine = this.curLineStart; }
    while (!this.closes(acorn.tokTypes.braceR, indent + (this.curLineStart <= continuedLine ? 1 : 0), line)) {
      var elt$1 = this$1.startNode();
      if (this$1.eat(acorn.tokTypes.star)) {
        elt$1.local = this$1.eatContextual("as") ? this$1.parseIdent() : this$1.dummyIdent();
        this$1.finishNode(elt$1, "ImportNamespaceSpecifier");
      } else {
        if (this$1.isContextual("from")) { break }
        elt$1.imported = this$1.parseIdent();
        if (isDummy(elt$1.imported)) { break }
        elt$1.local = this$1.eatContextual("as") ? this$1.parseIdent() : elt$1.imported;
        this$1.finishNode(elt$1, "ImportSpecifier");
      }
      elts.push(elt$1);
      this$1.eat(acorn.tokTypes.comma);
    }
    this.eat(acorn.tokTypes.braceR);
    this.popCx();
  }
  return elts
};

lp$1.parseExportSpecifierList = function() {
  var this$1 = this;

  var elts = [];
  var indent = this.curIndent, line = this.curLineStart, continuedLine = this.nextLineStart;
  this.pushCx();
  this.eat(acorn.tokTypes.braceL);
  if (this.curLineStart > continuedLine) { continuedLine = this.curLineStart; }
  while (!this.closes(acorn.tokTypes.braceR, indent + (this.curLineStart <= continuedLine ? 1 : 0), line)) {
    if (this$1.isContextual("from")) { break }
    var elt = this$1.startNode();
    elt.local = this$1.parseIdent();
    if (isDummy(elt.local)) { break }
    elt.exported = this$1.eatContextual("as") ? this$1.parseIdent() : elt.local;
    this$1.finishNode(elt, "ExportSpecifier");
    elts.push(elt);
    this$1.eat(acorn.tokTypes.comma);
  }
  this.eat(acorn.tokTypes.braceR);
  this.popCx();
  return elts
};

var lp$2 = LooseParser.prototype;

lp$2.checkLVal = function(expr) {
  if (!expr) { return expr }
  switch (expr.type) {
  case "Identifier":
  case "MemberExpression":
    return expr

  case "ParenthesizedExpression":
    expr.expression = this.checkLVal(expr.expression);
    return expr

  default:
    return this.dummyIdent()
  }
};

lp$2.parseExpression = function(noIn) {
  var this$1 = this;

  var start = this.storeCurrentPos();
  var expr = this.parseMaybeAssign(noIn);
  if (this.tok.type === acorn.tokTypes.comma) {
    var node = this.startNodeAt(start);
    node.expressions = [expr];
    while (this.eat(acorn.tokTypes.comma)) { node.expressions.push(this$1.parseMaybeAssign(noIn)); }
    return this.finishNode(node, "SequenceExpression")
  }
  return expr
};

lp$2.parseParenExpression = function() {
  this.pushCx();
  this.expect(acorn.tokTypes.parenL);
  var val = this.parseExpression();
  this.popCx();
  this.expect(acorn.tokTypes.parenR);
  return val
};

lp$2.parseMaybeAssign = function(noIn) {
  if (this.toks.isContextual("yield")) {
    var node = this.startNode();
    this.next();
    if (this.semicolon() || this.canInsertSemicolon() || (this.tok.type !== acorn.tokTypes.star && !this.tok.type.startsExpr)) {
      node.delegate = false;
      node.argument = null;
    } else {
      node.delegate = this.eat(acorn.tokTypes.star);
      node.argument = this.parseMaybeAssign();
    }
    return this.finishNode(node, "YieldExpression")
  }

  var start = this.storeCurrentPos();
  var left = this.parseMaybeConditional(noIn);
  if (this.tok.type.isAssign) {
    var node$1 = this.startNodeAt(start);
    node$1.operator = this.tok.value;
    node$1.left = this.tok.type === acorn.tokTypes.eq ? this.toAssignable(left) : this.checkLVal(left);
    this.next();
    node$1.right = this.parseMaybeAssign(noIn);
    return this.finishNode(node$1, "AssignmentExpression")
  }
  return left
};

lp$2.parseMaybeConditional = function(noIn) {
  var start = this.storeCurrentPos();
  var expr = this.parseExprOps(noIn);
  if (this.eat(acorn.tokTypes.question)) {
    var node = this.startNodeAt(start);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    node.alternate = this.expect(acorn.tokTypes.colon) ? this.parseMaybeAssign(noIn) : this.dummyIdent();
    return this.finishNode(node, "ConditionalExpression")
  }
  return expr
};

lp$2.parseExprOps = function(noIn) {
  var start = this.storeCurrentPos();
  var indent = this.curIndent, line = this.curLineStart;
  return this.parseExprOp(this.parseMaybeUnary(false), start, -1, noIn, indent, line)
};

lp$2.parseExprOp = function(left, start, minPrec, noIn, indent, line) {
  if (this.curLineStart !== line && this.curIndent < indent && this.tokenStartsLine()) { return left }
  var prec = this.tok.type.binop;
  if (prec != null && (!noIn || this.tok.type !== acorn.tokTypes._in)) {
    if (prec > minPrec) {
      var node = this.startNodeAt(start);
      node.left = left;
      node.operator = this.tok.value;
      this.next();
      if (this.curLineStart !== line && this.curIndent < indent && this.tokenStartsLine()) {
        node.right = this.dummyIdent();
      } else {
        var rightStart = this.storeCurrentPos();
        node.right = this.parseExprOp(this.parseMaybeUnary(false), rightStart, prec, noIn, indent, line);
      }
      this.finishNode(node, /&&|\|\|/.test(node.operator) ? "LogicalExpression" : "BinaryExpression");
      return this.parseExprOp(node, start, minPrec, noIn, indent, line)
    }
  }
  return left
};

lp$2.parseMaybeUnary = function(sawUnary) {
  var this$1 = this;

  var start = this.storeCurrentPos(), expr;
  if (this.options.ecmaVersion >= 8 && this.toks.isContextual("await") &&
    (this.inAsync || (!this.inFunction && this.options.allowAwaitOutsideFunction))
  ) {
    expr = this.parseAwait();
    sawUnary = true;
  } else if (this.tok.type.prefix) {
    var node = this.startNode(), update = this.tok.type === acorn.tokTypes.incDec;
    if (!update) { sawUnary = true; }
    node.operator = this.tok.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(true);
    if (update) { node.argument = this.checkLVal(node.argument); }
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else if (this.tok.type === acorn.tokTypes.ellipsis) {
    var node$1 = this.startNode();
    this.next();
    node$1.argument = this.parseMaybeUnary(sawUnary);
    expr = this.finishNode(node$1, "SpreadElement");
  } else {
    expr = this.parseExprSubscripts();
    while (this.tok.type.postfix && !this.canInsertSemicolon()) {
      var node$2 = this$1.startNodeAt(start);
      node$2.operator = this$1.tok.value;
      node$2.prefix = false;
      node$2.argument = this$1.checkLVal(expr);
      this$1.next();
      expr = this$1.finishNode(node$2, "UpdateExpression");
    }
  }

  if (!sawUnary && this.eat(acorn.tokTypes.starstar)) {
    var node$3 = this.startNodeAt(start);
    node$3.operator = "**";
    node$3.left = expr;
    node$3.right = this.parseMaybeUnary(false);
    return this.finishNode(node$3, "BinaryExpression")
  }

  return expr
};

lp$2.parseExprSubscripts = function() {
  var start = this.storeCurrentPos();
  return this.parseSubscripts(this.parseExprAtom(), start, false, this.curIndent, this.curLineStart)
};

lp$2.parseSubscripts = function(base, start, noCalls, startIndent, line) {
  var this$1 = this;

  for (;;) {
    if (this$1.curLineStart !== line && this$1.curIndent <= startIndent && this$1.tokenStartsLine()) {
      if (this$1.tok.type === acorn.tokTypes.dot && this$1.curIndent === startIndent)
        { --startIndent; }
      else
        { return base }
    }

    var maybeAsyncArrow = base.type === "Identifier" && base.name === "async" && !this$1.canInsertSemicolon();

    if (this$1.eat(acorn.tokTypes.dot)) {
      var node = this$1.startNodeAt(start);
      node.object = base;
      if (this$1.curLineStart !== line && this$1.curIndent <= startIndent && this$1.tokenStartsLine())
        { node.property = this$1.dummyIdent(); }
      else
        { node.property = this$1.parsePropertyAccessor() || this$1.dummyIdent(); }
      node.computed = false;
      base = this$1.finishNode(node, "MemberExpression");
    } else if (this$1.tok.type === acorn.tokTypes.bracketL) {
      this$1.pushCx();
      this$1.next();
      var node$1 = this$1.startNodeAt(start);
      node$1.object = base;
      node$1.property = this$1.parseExpression();
      node$1.computed = true;
      this$1.popCx();
      this$1.expect(acorn.tokTypes.bracketR);
      base = this$1.finishNode(node$1, "MemberExpression");
    } else if (!noCalls && this$1.tok.type === acorn.tokTypes.parenL) {
      var exprList = this$1.parseExprList(acorn.tokTypes.parenR);
      if (maybeAsyncArrow && this$1.eat(acorn.tokTypes.arrow))
        { return this$1.parseArrowExpression(this$1.startNodeAt(start), exprList, true) }
      var node$2 = this$1.startNodeAt(start);
      node$2.callee = base;
      node$2.arguments = exprList;
      base = this$1.finishNode(node$2, "CallExpression");
    } else if (this$1.tok.type === acorn.tokTypes.backQuote) {
      var node$3 = this$1.startNodeAt(start);
      node$3.tag = base;
      node$3.quasi = this$1.parseTemplate();
      base = this$1.finishNode(node$3, "TaggedTemplateExpression");
    } else {
      return base
    }
  }
};

lp$2.parseExprAtom = function() {
  var node;
  switch (this.tok.type) {
  case acorn.tokTypes._this:
  case acorn.tokTypes._super:
    var type = this.tok.type === acorn.tokTypes._this ? "ThisExpression" : "Super";
    node = this.startNode();
    this.next();
    return this.finishNode(node, type)

  case acorn.tokTypes.name:
    var start = this.storeCurrentPos();
    var id = this.parseIdent();
    var isAsync = false;
    if (id.name === "async" && !this.canInsertSemicolon()) {
      if (this.eat(acorn.tokTypes._function))
        { return this.parseFunction(this.startNodeAt(start), false, true) }
      if (this.tok.type === acorn.tokTypes.name) {
        id = this.parseIdent();
        isAsync = true;
      }
    }
    return this.eat(acorn.tokTypes.arrow) ? this.parseArrowExpression(this.startNodeAt(start), [id], isAsync) : id

  case acorn.tokTypes.regexp:
    node = this.startNode();
    var val = this.tok.value;
    node.regex = {pattern: val.pattern, flags: val.flags};
    node.value = val.value;
    node.raw = this.input.slice(this.tok.start, this.tok.end);
    this.next();
    return this.finishNode(node, "Literal")

  case acorn.tokTypes.num: case acorn.tokTypes.string:
    node = this.startNode();
    node.value = this.tok.value;
    node.raw = this.input.slice(this.tok.start, this.tok.end);
    this.next();
    return this.finishNode(node, "Literal")

  case acorn.tokTypes._null: case acorn.tokTypes._true: case acorn.tokTypes._false:
    node = this.startNode();
    node.value = this.tok.type === acorn.tokTypes._null ? null : this.tok.type === acorn.tokTypes._true;
    node.raw = this.tok.type.keyword;
    this.next();
    return this.finishNode(node, "Literal")

  case acorn.tokTypes.parenL:
    var parenStart = this.storeCurrentPos();
    this.next();
    var inner = this.parseExpression();
    this.expect(acorn.tokTypes.parenR);
    if (this.eat(acorn.tokTypes.arrow)) {
      // (a,)=>a // SequenceExpression makes dummy in the last hole. Drop the dummy.
      var params = inner.expressions || [inner];
      if (params.length && isDummy(params[params.length - 1]))
        { params.pop(); }
      return this.parseArrowExpression(this.startNodeAt(parenStart), params)
    }
    if (this.options.preserveParens) {
      var par = this.startNodeAt(parenStart);
      par.expression = inner;
      inner = this.finishNode(par, "ParenthesizedExpression");
    }
    return inner

  case acorn.tokTypes.bracketL:
    node = this.startNode();
    node.elements = this.parseExprList(acorn.tokTypes.bracketR, true);
    return this.finishNode(node, "ArrayExpression")

  case acorn.tokTypes.braceL:
    return this.parseObj()

  case acorn.tokTypes._class:
    return this.parseClass(false)

  case acorn.tokTypes._function:
    node = this.startNode();
    this.next();
    return this.parseFunction(node, false)

  case acorn.tokTypes._new:
    return this.parseNew()

  case acorn.tokTypes.backQuote:
    return this.parseTemplate()

  default:
    return this.dummyIdent()
  }
};

lp$2.parseNew = function() {
  var node = this.startNode(), startIndent = this.curIndent, line = this.curLineStart;
  var meta = this.parseIdent(true);
  if (this.options.ecmaVersion >= 6 && this.eat(acorn.tokTypes.dot)) {
    node.meta = meta;
    node.property = this.parseIdent(true);
    return this.finishNode(node, "MetaProperty")
  }
  var start = this.storeCurrentPos();
  node.callee = this.parseSubscripts(this.parseExprAtom(), start, true, startIndent, line);
  if (this.tok.type === acorn.tokTypes.parenL) {
    node.arguments = this.parseExprList(acorn.tokTypes.parenR);
  } else {
    node.arguments = [];
  }
  return this.finishNode(node, "NewExpression")
};

lp$2.parseTemplateElement = function() {
  var elem = this.startNode();

  // The loose parser accepts invalid unicode escapes even in untagged templates.
  if (this.tok.type === acorn.tokTypes.invalidTemplate) {
    elem.value = {
      raw: this.tok.value,
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.tok.start, this.tok.end).replace(/\r\n?/g, "\n"),
      cooked: this.tok.value
    };
  }
  this.next();
  elem.tail = this.tok.type === acorn.tokTypes.backQuote;
  return this.finishNode(elem, "TemplateElement")
};

lp$2.parseTemplate = function() {
  var this$1 = this;

  var node = this.startNode();
  this.next();
  node.expressions = [];
  var curElt = this.parseTemplateElement();
  node.quasis = [curElt];
  while (!curElt.tail) {
    this$1.next();
    node.expressions.push(this$1.parseExpression());
    if (this$1.expect(acorn.tokTypes.braceR)) {
      curElt = this$1.parseTemplateElement();
    } else {
      curElt = this$1.startNode();
      curElt.value = {cooked: "", raw: ""};
      curElt.tail = true;
      this$1.finishNode(curElt, "TemplateElement");
    }
    node.quasis.push(curElt);
  }
  this.expect(acorn.tokTypes.backQuote);
  return this.finishNode(node, "TemplateLiteral")
};

lp$2.parseObj = function() {
  var this$1 = this;

  var node = this.startNode();
  node.properties = [];
  this.pushCx();
  var indent = this.curIndent + 1, line = this.curLineStart;
  this.eat(acorn.tokTypes.braceL);
  if (this.curIndent + 1 < indent) { indent = this.curIndent; line = this.curLineStart; }
  while (!this.closes(acorn.tokTypes.braceR, indent, line)) {
    var prop = this$1.startNode(), isGenerator = (void 0), isAsync = (void 0), start = (void 0);
    if (this$1.options.ecmaVersion >= 9 && this$1.eat(acorn.tokTypes.ellipsis)) {
      prop.argument = this$1.parseMaybeAssign();
      node.properties.push(this$1.finishNode(prop, "SpreadElement"));
      this$1.eat(acorn.tokTypes.comma);
      continue
    }
    if (this$1.options.ecmaVersion >= 6) {
      start = this$1.storeCurrentPos();
      prop.method = false;
      prop.shorthand = false;
      isGenerator = this$1.eat(acorn.tokTypes.star);
    }
    this$1.parsePropertyName(prop);
    if (this$1.toks.isAsyncProp(prop)) {
      isAsync = true;
      isGenerator = this$1.options.ecmaVersion >= 9 && this$1.eat(acorn.tokTypes.star);
      this$1.parsePropertyName(prop);
    } else {
      isAsync = false;
    }
    if (isDummy(prop.key)) { if (isDummy(this$1.parseMaybeAssign())) { this$1.next(); } this$1.eat(acorn.tokTypes.comma); continue }
    if (this$1.eat(acorn.tokTypes.colon)) {
      prop.kind = "init";
      prop.value = this$1.parseMaybeAssign();
    } else if (this$1.options.ecmaVersion >= 6 && (this$1.tok.type === acorn.tokTypes.parenL || this$1.tok.type === acorn.tokTypes.braceL)) {
      prop.kind = "init";
      prop.method = true;
      prop.value = this$1.parseMethod(isGenerator, isAsync);
    } else if (this$1.options.ecmaVersion >= 5 && prop.key.type === "Identifier" &&
               !prop.computed && (prop.key.name === "get" || prop.key.name === "set") &&
               (this$1.tok.type !== acorn.tokTypes.comma && this$1.tok.type !== acorn.tokTypes.braceR && this$1.tok.type !== acorn.tokTypes.eq)) {
      prop.kind = prop.key.name;
      this$1.parsePropertyName(prop);
      prop.value = this$1.parseMethod(false);
    } else {
      prop.kind = "init";
      if (this$1.options.ecmaVersion >= 6) {
        if (this$1.eat(acorn.tokTypes.eq)) {
          var assign = this$1.startNodeAt(start);
          assign.operator = "=";
          assign.left = prop.key;
          assign.right = this$1.parseMaybeAssign();
          prop.value = this$1.finishNode(assign, "AssignmentExpression");
        } else {
          prop.value = prop.key;
        }
      } else {
        prop.value = this$1.dummyIdent();
      }
      prop.shorthand = true;
    }
    node.properties.push(this$1.finishNode(prop, "Property"));
    this$1.eat(acorn.tokTypes.comma);
  }
  this.popCx();
  if (!this.eat(acorn.tokTypes.braceR)) {
    // If there is no closing brace, make the node span to the start
    // of the next token (this is useful for Tern)
    this.last.end = this.tok.start;
    if (this.options.locations) { this.last.loc.end = this.tok.loc.start; }
  }
  return this.finishNode(node, "ObjectExpression")
};

lp$2.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(acorn.tokTypes.bracketL)) {
      prop.computed = true;
      prop.key = this.parseExpression();
      this.expect(acorn.tokTypes.bracketR);
      return
    } else {
      prop.computed = false;
    }
  }
  var key = (this.tok.type === acorn.tokTypes.num || this.tok.type === acorn.tokTypes.string) ? this.parseExprAtom() : this.parseIdent();
  prop.key = key || this.dummyIdent();
};

lp$2.parsePropertyAccessor = function() {
  if (this.tok.type === acorn.tokTypes.name || this.tok.type.keyword) { return this.parseIdent() }
};

lp$2.parseIdent = function() {
  var name = this.tok.type === acorn.tokTypes.name ? this.tok.value : this.tok.type.keyword;
  if (!name) { return this.dummyIdent() }
  var node = this.startNode();
  this.next();
  node.name = name;
  return this.finishNode(node, "Identifier")
};

lp$2.initFunction = function(node) {
  node.id = null;
  node.params = [];
  if (this.options.ecmaVersion >= 6) {
    node.generator = false;
    node.expression = false;
  }
  if (this.options.ecmaVersion >= 8)
    { node.async = false; }
};

// Convert existing expression atom to assignable pattern
// if possible.

lp$2.toAssignable = function(node, binding) {
  var this$1 = this;

  if (!node || node.type === "Identifier" || (node.type === "MemberExpression" && !binding)) {
    // Okay
  } else if (node.type === "ParenthesizedExpression") {
    this.toAssignable(node.expression, binding);
  } else if (this.options.ecmaVersion < 6) {
    return this.dummyIdent()
  } else if (node.type === "ObjectExpression") {
    node.type = "ObjectPattern";
    for (var i = 0, list = node.properties; i < list.length; i += 1)
      {
      var prop = list[i];

      this$1.toAssignable(prop, binding);
    }
  } else if (node.type === "ArrayExpression") {
    node.type = "ArrayPattern";
    this.toAssignableList(node.elements, binding);
  } else if (node.type === "Property") {
    this.toAssignable(node.value, binding);
  } else if (node.type === "SpreadElement") {
    node.type = "RestElement";
    this.toAssignable(node.argument, binding);
  } else if (node.type === "AssignmentExpression") {
    node.type = "AssignmentPattern";
    delete node.operator;
  } else {
    return this.dummyIdent()
  }
  return node
};

lp$2.toAssignableList = function(exprList, binding) {
  var this$1 = this;

  for (var i = 0, list = exprList; i < list.length; i += 1)
    {
    var expr = list[i];

    this$1.toAssignable(expr, binding);
  }
  return exprList
};

lp$2.parseFunctionParams = function(params) {
  params = this.parseExprList(acorn.tokTypes.parenR);
  return this.toAssignableList(params, true)
};

lp$2.parseMethod = function(isGenerator, isAsync) {
  var node = this.startNode(), oldInAsync = this.inAsync, oldInFunction = this.inFunction;
  this.initFunction(node);
  if (this.options.ecmaVersion >= 6)
    { node.generator = !!isGenerator; }
  if (this.options.ecmaVersion >= 8)
    { node.async = !!isAsync; }
  this.inAsync = node.async;
  this.inFunction = true;
  node.params = this.parseFunctionParams();
  node.body = this.parseBlock();
  this.toks.adaptDirectivePrologue(node.body.body);
  this.inAsync = oldInAsync;
  this.inFunction = oldInFunction;
  return this.finishNode(node, "FunctionExpression")
};

lp$2.parseArrowExpression = function(node, params, isAsync) {
  var oldInAsync = this.inAsync, oldInFunction = this.inFunction;
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8)
    { node.async = !!isAsync; }
  this.inAsync = node.async;
  this.inFunction = true;
  node.params = this.toAssignableList(params, true);
  node.expression = this.tok.type !== acorn.tokTypes.braceL;
  if (node.expression) {
    node.body = this.parseMaybeAssign();
  } else {
    node.body = this.parseBlock();
    this.toks.adaptDirectivePrologue(node.body.body);
  }
  this.inAsync = oldInAsync;
  this.inFunction = oldInFunction;
  return this.finishNode(node, "ArrowFunctionExpression")
};

lp$2.parseExprList = function(close, allowEmpty) {
  var this$1 = this;

  this.pushCx();
  var indent = this.curIndent, line = this.curLineStart, elts = [];
  this.next(); // Opening bracket
  while (!this.closes(close, indent + 1, line)) {
    if (this$1.eat(acorn.tokTypes.comma)) {
      elts.push(allowEmpty ? null : this$1.dummyIdent());
      continue
    }
    var elt = this$1.parseMaybeAssign();
    if (isDummy(elt)) {
      if (this$1.closes(close, indent, line)) { break }
      this$1.next();
    } else {
      elts.push(elt);
    }
    this$1.eat(acorn.tokTypes.comma);
  }
  this.popCx();
  if (!this.eat(close)) {
    // If there is no closing brace, make the node span to the start
    // of the next token (this is useful for Tern)
    this.last.end = this.tok.start;
    if (this.options.locations) { this.last.loc.end = this.tok.loc.start; }
  }
  return elts
};

lp$2.parseAwait = function() {
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary();
  return this.finishNode(node, "AwaitExpression")
};

// Acorn: Loose parser
//
// This module provides an alternative parser that exposes that same
// interface as the main module's `parse` function, but will try to
// parse anything as JavaScript, repairing syntax error the best it
// can. There are circumstances in which it will raise an error and
// give up, but they are very rare. The resulting AST will be a mostly
// valid JavaScript AST (as per the [Mozilla parser API][api], except
// that:
//
// - Return outside functions is allowed
//
// - Label consistency (no conflicts, break only to existing labels)
//   is not enforced.
//
// - Bogus Identifier nodes with a name of `"✖"` are inserted whenever
//   the parser got too confused to return anything meaningful.
//
// [api]: https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API
//
// The expected use for this is to *first* try `acorn.parse`, and only
// if that fails switch to the loose parser. The loose parser might
// parse badly indented code incorrectly, so **don't** use it as your
// default parser.
//
// Quite a lot of acorn.js is duplicated here. The alternative was to
// add a *lot* of extra cruft to that file, making it less readable
// and slower. Copying and editing the code allowed me to make
// invasive changes and simplifications without creating a complicated
// tangle.

acorn.defaultOptions.tabSize = 4;

function parse(input, options) {
  return LooseParser.parse(input, options)
}

exports.parse = parse;
exports.LooseParser = LooseParser;

Object.defineProperty(exports, '__esModule', { value: true });

})));


},{"acorn":14}],14:[function(require,module,exports){
(function (global, factory) {
	typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
	typeof define === 'function' && define.amd ? define(['exports'], factory) :
	(factory((global.acorn = {})));
}(this, (function (exports) { 'use strict';

// Reserved word lists for various dialects of the language

var reservedWords = {
  3: "abstract boolean byte char class double enum export extends final float goto implements import int interface long native package private protected public short static super synchronized throws transient volatile",
  5: "class enum extends super const export import",
  6: "enum",
  strict: "implements interface let package private protected public static yield",
  strictBind: "eval arguments"
};

// And the keywords

var ecma5AndLessKeywords = "break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this";

var keywords = {
  5: ecma5AndLessKeywords,
  6: ecma5AndLessKeywords + " const class extends export import super"
};

var keywordRelationalOperator = /^in(stanceof)?$/;

// ## Character categories

// Big ugly regular expressions that match characters in the
// whitespace, identifier, and identifier-start categories. These
// are only applied when a character is found to actually have a
// code point above 128.
// Generated by `bin/generate-identifier-regex.js`.

var nonASCIIidentifierStartChars = "\xaa\xb5\xba\xc0-\xd6\xd8-\xf6\xf8-\u02c1\u02c6-\u02d1\u02e0-\u02e4\u02ec\u02ee\u0370-\u0374\u0376\u0377\u037a-\u037d\u037f\u0386\u0388-\u038a\u038c\u038e-\u03a1\u03a3-\u03f5\u03f7-\u0481\u048a-\u052f\u0531-\u0556\u0559\u0560-\u0588\u05d0-\u05ea\u05ef-\u05f2\u0620-\u064a\u066e\u066f\u0671-\u06d3\u06d5\u06e5\u06e6\u06ee\u06ef\u06fa-\u06fc\u06ff\u0710\u0712-\u072f\u074d-\u07a5\u07b1\u07ca-\u07ea\u07f4\u07f5\u07fa\u0800-\u0815\u081a\u0824\u0828\u0840-\u0858\u0860-\u086a\u08a0-\u08b4\u08b6-\u08bd\u0904-\u0939\u093d\u0950\u0958-\u0961\u0971-\u0980\u0985-\u098c\u098f\u0990\u0993-\u09a8\u09aa-\u09b0\u09b2\u09b6-\u09b9\u09bd\u09ce\u09dc\u09dd\u09df-\u09e1\u09f0\u09f1\u09fc\u0a05-\u0a0a\u0a0f\u0a10\u0a13-\u0a28\u0a2a-\u0a30\u0a32\u0a33\u0a35\u0a36\u0a38\u0a39\u0a59-\u0a5c\u0a5e\u0a72-\u0a74\u0a85-\u0a8d\u0a8f-\u0a91\u0a93-\u0aa8\u0aaa-\u0ab0\u0ab2\u0ab3\u0ab5-\u0ab9\u0abd\u0ad0\u0ae0\u0ae1\u0af9\u0b05-\u0b0c\u0b0f\u0b10\u0b13-\u0b28\u0b2a-\u0b30\u0b32\u0b33\u0b35-\u0b39\u0b3d\u0b5c\u0b5d\u0b5f-\u0b61\u0b71\u0b83\u0b85-\u0b8a\u0b8e-\u0b90\u0b92-\u0b95\u0b99\u0b9a\u0b9c\u0b9e\u0b9f\u0ba3\u0ba4\u0ba8-\u0baa\u0bae-\u0bb9\u0bd0\u0c05-\u0c0c\u0c0e-\u0c10\u0c12-\u0c28\u0c2a-\u0c39\u0c3d\u0c58-\u0c5a\u0c60\u0c61\u0c80\u0c85-\u0c8c\u0c8e-\u0c90\u0c92-\u0ca8\u0caa-\u0cb3\u0cb5-\u0cb9\u0cbd\u0cde\u0ce0\u0ce1\u0cf1\u0cf2\u0d05-\u0d0c\u0d0e-\u0d10\u0d12-\u0d3a\u0d3d\u0d4e\u0d54-\u0d56\u0d5f-\u0d61\u0d7a-\u0d7f\u0d85-\u0d96\u0d9a-\u0db1\u0db3-\u0dbb\u0dbd\u0dc0-\u0dc6\u0e01-\u0e30\u0e32\u0e33\u0e40-\u0e46\u0e81\u0e82\u0e84\u0e87\u0e88\u0e8a\u0e8d\u0e94-\u0e97\u0e99-\u0e9f\u0ea1-\u0ea3\u0ea5\u0ea7\u0eaa\u0eab\u0ead-\u0eb0\u0eb2\u0eb3\u0ebd\u0ec0-\u0ec4\u0ec6\u0edc-\u0edf\u0f00\u0f40-\u0f47\u0f49-\u0f6c\u0f88-\u0f8c\u1000-\u102a\u103f\u1050-\u1055\u105a-\u105d\u1061\u1065\u1066\u106e-\u1070\u1075-\u1081\u108e\u10a0-\u10c5\u10c7\u10cd\u10d0-\u10fa\u10fc-\u1248\u124a-\u124d\u1250-\u1256\u1258\u125a-\u125d\u1260-\u1288\u128a-\u128d\u1290-\u12b0\u12b2-\u12b5\u12b8-\u12be\u12c0\u12c2-\u12c5\u12c8-\u12d6\u12d8-\u1310\u1312-\u1315\u1318-\u135a\u1380-\u138f\u13a0-\u13f5\u13f8-\u13fd\u1401-\u166c\u166f-\u167f\u1681-\u169a\u16a0-\u16ea\u16ee-\u16f8\u1700-\u170c\u170e-\u1711\u1720-\u1731\u1740-\u1751\u1760-\u176c\u176e-\u1770\u1780-\u17b3\u17d7\u17dc\u1820-\u1878\u1880-\u18a8\u18aa\u18b0-\u18f5\u1900-\u191e\u1950-\u196d\u1970-\u1974\u1980-\u19ab\u19b0-\u19c9\u1a00-\u1a16\u1a20-\u1a54\u1aa7\u1b05-\u1b33\u1b45-\u1b4b\u1b83-\u1ba0\u1bae\u1baf\u1bba-\u1be5\u1c00-\u1c23\u1c4d-\u1c4f\u1c5a-\u1c7d\u1c80-\u1c88\u1c90-\u1cba\u1cbd-\u1cbf\u1ce9-\u1cec\u1cee-\u1cf1\u1cf5\u1cf6\u1d00-\u1dbf\u1e00-\u1f15\u1f18-\u1f1d\u1f20-\u1f45\u1f48-\u1f4d\u1f50-\u1f57\u1f59\u1f5b\u1f5d\u1f5f-\u1f7d\u1f80-\u1fb4\u1fb6-\u1fbc\u1fbe\u1fc2-\u1fc4\u1fc6-\u1fcc\u1fd0-\u1fd3\u1fd6-\u1fdb\u1fe0-\u1fec\u1ff2-\u1ff4\u1ff6-\u1ffc\u2071\u207f\u2090-\u209c\u2102\u2107\u210a-\u2113\u2115\u2118-\u211d\u2124\u2126\u2128\u212a-\u2139\u213c-\u213f\u2145-\u2149\u214e\u2160-\u2188\u2c00-\u2c2e\u2c30-\u2c5e\u2c60-\u2ce4\u2ceb-\u2cee\u2cf2\u2cf3\u2d00-\u2d25\u2d27\u2d2d\u2d30-\u2d67\u2d6f\u2d80-\u2d96\u2da0-\u2da6\u2da8-\u2dae\u2db0-\u2db6\u2db8-\u2dbe\u2dc0-\u2dc6\u2dc8-\u2dce\u2dd0-\u2dd6\u2dd8-\u2dde\u3005-\u3007\u3021-\u3029\u3031-\u3035\u3038-\u303c\u3041-\u3096\u309b-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3105-\u312f\u3131-\u318e\u31a0-\u31ba\u31f0-\u31ff\u3400-\u4db5\u4e00-\u9fef\ua000-\ua48c\ua4d0-\ua4fd\ua500-\ua60c\ua610-\ua61f\ua62a\ua62b\ua640-\ua66e\ua67f-\ua69d\ua6a0-\ua6ef\ua717-\ua71f\ua722-\ua788\ua78b-\ua7b9\ua7f7-\ua801\ua803-\ua805\ua807-\ua80a\ua80c-\ua822\ua840-\ua873\ua882-\ua8b3\ua8f2-\ua8f7\ua8fb\ua8fd\ua8fe\ua90a-\ua925\ua930-\ua946\ua960-\ua97c\ua984-\ua9b2\ua9cf\ua9e0-\ua9e4\ua9e6-\ua9ef\ua9fa-\ua9fe\uaa00-\uaa28\uaa40-\uaa42\uaa44-\uaa4b\uaa60-\uaa76\uaa7a\uaa7e-\uaaaf\uaab1\uaab5\uaab6\uaab9-\uaabd\uaac0\uaac2\uaadb-\uaadd\uaae0-\uaaea\uaaf2-\uaaf4\uab01-\uab06\uab09-\uab0e\uab11-\uab16\uab20-\uab26\uab28-\uab2e\uab30-\uab5a\uab5c-\uab65\uab70-\uabe2\uac00-\ud7a3\ud7b0-\ud7c6\ud7cb-\ud7fb\uf900-\ufa6d\ufa70-\ufad9\ufb00-\ufb06\ufb13-\ufb17\ufb1d\ufb1f-\ufb28\ufb2a-\ufb36\ufb38-\ufb3c\ufb3e\ufb40\ufb41\ufb43\ufb44\ufb46-\ufbb1\ufbd3-\ufd3d\ufd50-\ufd8f\ufd92-\ufdc7\ufdf0-\ufdfb\ufe70-\ufe74\ufe76-\ufefc\uff21-\uff3a\uff41-\uff5a\uff66-\uffbe\uffc2-\uffc7\uffca-\uffcf\uffd2-\uffd7\uffda-\uffdc";
var nonASCIIidentifierChars = "\u200c\u200d\xb7\u0300-\u036f\u0387\u0483-\u0487\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u0669\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed\u06f0-\u06f9\u0711\u0730-\u074a\u07a6-\u07b0\u07c0-\u07c9\u07eb-\u07f3\u07fd\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0859-\u085b\u08d3-\u08e1\u08e3-\u0903\u093a-\u093c\u093e-\u094f\u0951-\u0957\u0962\u0963\u0966-\u096f\u0981-\u0983\u09bc\u09be-\u09c4\u09c7\u09c8\u09cb-\u09cd\u09d7\u09e2\u09e3\u09e6-\u09ef\u09fe\u0a01-\u0a03\u0a3c\u0a3e-\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a66-\u0a71\u0a75\u0a81-\u0a83\u0abc\u0abe-\u0ac5\u0ac7-\u0ac9\u0acb-\u0acd\u0ae2\u0ae3\u0ae6-\u0aef\u0afa-\u0aff\u0b01-\u0b03\u0b3c\u0b3e-\u0b44\u0b47\u0b48\u0b4b-\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b66-\u0b6f\u0b82\u0bbe-\u0bc2\u0bc6-\u0bc8\u0bca-\u0bcd\u0bd7\u0be6-\u0bef\u0c00-\u0c04\u0c3e-\u0c44\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0c66-\u0c6f\u0c81-\u0c83\u0cbc\u0cbe-\u0cc4\u0cc6-\u0cc8\u0cca-\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0ce6-\u0cef\u0d00-\u0d03\u0d3b\u0d3c\u0d3e-\u0d44\u0d46-\u0d48\u0d4a-\u0d4d\u0d57\u0d62\u0d63\u0d66-\u0d6f\u0d82\u0d83\u0dca\u0dcf-\u0dd4\u0dd6\u0dd8-\u0ddf\u0de6-\u0def\u0df2\u0df3\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0e50-\u0e59\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0ed0-\u0ed9\u0f18\u0f19\u0f20-\u0f29\u0f35\u0f37\u0f39\u0f3e\u0f3f\u0f71-\u0f84\u0f86\u0f87\u0f8d-\u0f97\u0f99-\u0fbc\u0fc6\u102b-\u103e\u1040-\u1049\u1056-\u1059\u105e-\u1060\u1062-\u1064\u1067-\u106d\u1071-\u1074\u1082-\u108d\u108f-\u109d\u135d-\u135f\u1369-\u1371\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b4-\u17d3\u17dd\u17e0-\u17e9\u180b-\u180d\u1810-\u1819\u18a9\u1920-\u192b\u1930-\u193b\u1946-\u194f\u19d0-\u19da\u1a17-\u1a1b\u1a55-\u1a5e\u1a60-\u1a7c\u1a7f-\u1a89\u1a90-\u1a99\u1ab0-\u1abd\u1b00-\u1b04\u1b34-\u1b44\u1b50-\u1b59\u1b6b-\u1b73\u1b80-\u1b82\u1ba1-\u1bad\u1bb0-\u1bb9\u1be6-\u1bf3\u1c24-\u1c37\u1c40-\u1c49\u1c50-\u1c59\u1cd0-\u1cd2\u1cd4-\u1ce8\u1ced\u1cf2-\u1cf4\u1cf7-\u1cf9\u1dc0-\u1df9\u1dfb-\u1dff\u203f\u2040\u2054\u20d0-\u20dc\u20e1\u20e5-\u20f0\u2cef-\u2cf1\u2d7f\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua620-\ua629\ua66f\ua674-\ua67d\ua69e\ua69f\ua6f0\ua6f1\ua802\ua806\ua80b\ua823-\ua827\ua880\ua881\ua8b4-\ua8c5\ua8d0-\ua8d9\ua8e0-\ua8f1\ua8ff-\ua909\ua926-\ua92d\ua947-\ua953\ua980-\ua983\ua9b3-\ua9c0\ua9d0-\ua9d9\ua9e5\ua9f0-\ua9f9\uaa29-\uaa36\uaa43\uaa4c\uaa4d\uaa50-\uaa59\uaa7b-\uaa7d\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uaaeb-\uaaef\uaaf5\uaaf6\uabe3-\uabea\uabec\uabed\uabf0-\uabf9\ufb1e\ufe00-\ufe0f\ufe20-\ufe2f\ufe33\ufe34\ufe4d-\ufe4f\uff10-\uff19\uff3f";

var nonASCIIidentifierStart = new RegExp("[" + nonASCIIidentifierStartChars + "]");
var nonASCIIidentifier = new RegExp("[" + nonASCIIidentifierStartChars + nonASCIIidentifierChars + "]");

nonASCIIidentifierStartChars = nonASCIIidentifierChars = null;

// These are a run-length and offset encoded representation of the
// >0xffff code points that are a valid part of identifiers. The
// offset starts at 0x10000, and each pair of numbers represents an
// offset to the next range, and then a size of the range. They were
// generated by bin/generate-identifier-regex.js

// eslint-disable-next-line comma-spacing
var astralIdentifierStartCodes = [0,11,2,25,2,18,2,1,2,14,3,13,35,122,70,52,268,28,4,48,48,31,14,29,6,37,11,29,3,35,5,7,2,4,43,157,19,35,5,35,5,39,9,51,157,310,10,21,11,7,153,5,3,0,2,43,2,1,4,0,3,22,11,22,10,30,66,18,2,1,11,21,11,25,71,55,7,1,65,0,16,3,2,2,2,28,43,28,4,28,36,7,2,27,28,53,11,21,11,18,14,17,111,72,56,50,14,50,14,35,477,28,11,0,9,21,190,52,76,44,33,24,27,35,30,0,12,34,4,0,13,47,15,3,22,0,2,0,36,17,2,24,85,6,2,0,2,3,2,14,2,9,8,46,39,7,3,1,3,21,2,6,2,1,2,4,4,0,19,0,13,4,159,52,19,3,54,47,21,1,2,0,185,46,42,3,37,47,21,0,60,42,86,26,230,43,117,63,32,0,257,0,11,39,8,0,22,0,12,39,3,3,20,0,35,56,264,8,2,36,18,0,50,29,113,6,2,1,2,37,22,0,26,5,2,1,2,31,15,0,328,18,270,921,103,110,18,195,2749,1070,4050,582,8634,568,8,30,114,29,19,47,17,3,32,20,6,18,689,63,129,68,12,0,67,12,65,1,31,6129,15,754,9486,286,82,395,2309,106,6,12,4,8,8,9,5991,84,2,70,2,1,3,0,3,1,3,3,2,11,2,0,2,6,2,64,2,3,3,7,2,6,2,27,2,3,2,4,2,0,4,6,2,339,3,24,2,24,2,30,2,24,2,30,2,24,2,30,2,24,2,30,2,24,2,7,4149,196,60,67,1213,3,2,26,2,1,2,0,3,0,2,9,2,3,2,0,2,0,7,0,5,0,2,0,2,0,2,2,2,1,2,0,3,0,2,0,2,0,2,0,2,0,2,1,2,0,3,3,2,6,2,3,2,3,2,0,2,9,2,16,6,2,2,4,2,16,4421,42710,42,4148,12,221,3,5761,15,7472,3104,541];

// eslint-disable-next-line comma-spacing
var astralIdentifierCodes = [509,0,227,0,150,4,294,9,1368,2,2,1,6,3,41,2,5,0,166,1,574,3,9,9,525,10,176,2,54,14,32,9,16,3,46,10,54,9,7,2,37,13,2,9,6,1,45,0,13,2,49,13,9,3,4,9,83,11,7,0,161,11,6,9,7,3,56,1,2,6,3,1,3,2,10,0,11,1,3,6,4,4,193,17,10,9,5,0,82,19,13,9,214,6,3,8,28,1,83,16,16,9,82,12,9,9,84,14,5,9,243,14,166,9,280,9,41,6,2,3,9,0,10,10,47,15,406,7,2,7,17,9,57,21,2,13,123,5,4,0,2,1,2,6,2,0,9,9,49,4,2,1,2,4,9,9,330,3,19306,9,135,4,60,6,26,9,1016,45,17,3,19723,1,5319,4,4,5,9,7,3,6,31,3,149,2,1418,49,513,54,5,49,9,0,15,0,23,4,2,14,1361,6,2,16,3,6,2,1,2,4,2214,6,110,6,6,9,792487,239];

// This has a complexity linear to the value of the code. The
// assumption is that looking up astral identifier characters is
// rare.
function isInAstralSet(code, set) {
  var pos = 0x10000;
  for (var i = 0; i < set.length; i += 2) {
    pos += set[i];
    if (pos > code) { return false }
    pos += set[i + 1];
    if (pos >= code) { return true }
  }
}

// Test whether a given character code starts an identifier.

function isIdentifierStart(code, astral) {
  if (code < 65) { return code === 36 }
  if (code < 91) { return true }
  if (code < 97) { return code === 95 }
  if (code < 123) { return true }
  if (code <= 0xffff) { return code >= 0xaa && nonASCIIidentifierStart.test(String.fromCharCode(code)) }
  if (astral === false) { return false }
  return isInAstralSet(code, astralIdentifierStartCodes)
}

// Test whether a given character is part of an identifier.

function isIdentifierChar(code, astral) {
  if (code < 48) { return code === 36 }
  if (code < 58) { return true }
  if (code < 65) { return false }
  if (code < 91) { return true }
  if (code < 97) { return code === 95 }
  if (code < 123) { return true }
  if (code <= 0xffff) { return code >= 0xaa && nonASCIIidentifier.test(String.fromCharCode(code)) }
  if (astral === false) { return false }
  return isInAstralSet(code, astralIdentifierStartCodes) || isInAstralSet(code, astralIdentifierCodes)
}

// ## Token types

// The assignment of fine-grained, information-carrying type objects
// allows the tokenizer to store the information it has about a
// token in a way that is very cheap for the parser to look up.

// All token type variables start with an underscore, to make them
// easy to recognize.

// The `beforeExpr` property is used to disambiguate between regular
// expressions and divisions. It is set on all token types that can
// be followed by an expression (thus, a slash after them would be a
// regular expression).
//
// The `startsExpr` property is used to check if the token ends a
// `yield` expression. It is set on all token types that either can
// directly start an expression (like a quotation mark) or can
// continue an expression (like the body of a string).
//
// `isLoop` marks a keyword as starting a loop, which is important
// to know when parsing a label, in order to allow or disallow
// continue jumps to that label.

var TokenType = function TokenType(label, conf) {
  if ( conf === void 0 ) conf = {};

  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.isAssign = !!conf.isAssign;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.binop = conf.binop || null;
  this.updateContext = null;
};

function binop(name, prec) {
  return new TokenType(name, {beforeExpr: true, binop: prec})
}
var beforeExpr = {beforeExpr: true};
var startsExpr = {startsExpr: true};

// Map keyword names to token types.

var keywords$1 = {};

// Succinct definitions of keyword token types
function kw(name, options) {
  if ( options === void 0 ) options = {};

  options.keyword = name;
  return keywords$1[name] = new TokenType(name, options)
}

var types = {
  num: new TokenType("num", startsExpr),
  regexp: new TokenType("regexp", startsExpr),
  string: new TokenType("string", startsExpr),
  name: new TokenType("name", startsExpr),
  eof: new TokenType("eof"),

  // Punctuation token types.
  bracketL: new TokenType("[", {beforeExpr: true, startsExpr: true}),
  bracketR: new TokenType("]"),
  braceL: new TokenType("{", {beforeExpr: true, startsExpr: true}),
  braceR: new TokenType("}"),
  parenL: new TokenType("(", {beforeExpr: true, startsExpr: true}),
  parenR: new TokenType(")"),
  comma: new TokenType(",", beforeExpr),
  semi: new TokenType(";", beforeExpr),
  colon: new TokenType(":", beforeExpr),
  dot: new TokenType("."),
  question: new TokenType("?", beforeExpr),
  arrow: new TokenType("=>", beforeExpr),
  template: new TokenType("template"),
  invalidTemplate: new TokenType("invalidTemplate"),
  ellipsis: new TokenType("...", beforeExpr),
  backQuote: new TokenType("`", startsExpr),
  dollarBraceL: new TokenType("${", {beforeExpr: true, startsExpr: true}),

  // Operators. These carry several kinds of properties to help the
  // parser use them properly (the presence of these properties is
  // what categorizes them as operators).
  //
  // `binop`, when present, specifies that this operator is a binary
  // operator, and will refer to its precedence.
  //
  // `prefix` and `postfix` mark the operator as a prefix or postfix
  // unary operator.
  //
  // `isAssign` marks all of `=`, `+=`, `-=` etcetera, which act as
  // binary operators with a very low precedence, that should result
  // in AssignmentExpression nodes.

  eq: new TokenType("=", {beforeExpr: true, isAssign: true}),
  assign: new TokenType("_=", {beforeExpr: true, isAssign: true}),
  incDec: new TokenType("++/--", {prefix: true, postfix: true, startsExpr: true}),
  prefix: new TokenType("!/~", {beforeExpr: true, prefix: true, startsExpr: true}),
  logicalOR: binop("||", 1),
  logicalAND: binop("&&", 2),
  bitwiseOR: binop("|", 3),
  bitwiseXOR: binop("^", 4),
  bitwiseAND: binop("&", 5),
  equality: binop("==/!=/===/!==", 6),
  relational: binop("</>/<=/>=", 7),
  bitShift: binop("<</>>/>>>", 8),
  plusMin: new TokenType("+/-", {beforeExpr: true, binop: 9, prefix: true, startsExpr: true}),
  modulo: binop("%", 10),
  star: binop("*", 10),
  slash: binop("/", 10),
  starstar: new TokenType("**", {beforeExpr: true}),

  // Keyword token types.
  _break: kw("break"),
  _case: kw("case", beforeExpr),
  _catch: kw("catch"),
  _continue: kw("continue"),
  _debugger: kw("debugger"),
  _default: kw("default", beforeExpr),
  _do: kw("do", {isLoop: true, beforeExpr: true}),
  _else: kw("else", beforeExpr),
  _finally: kw("finally"),
  _for: kw("for", {isLoop: true}),
  _function: kw("function", startsExpr),
  _if: kw("if"),
  _return: kw("return", beforeExpr),
  _switch: kw("switch"),
  _throw: kw("throw", beforeExpr),
  _try: kw("try"),
  _var: kw("var"),
  _const: kw("const"),
  _while: kw("while", {isLoop: true}),
  _with: kw("with"),
  _new: kw("new", {beforeExpr: true, startsExpr: true}),
  _this: kw("this", startsExpr),
  _super: kw("super", startsExpr),
  _class: kw("class", startsExpr),
  _extends: kw("extends", beforeExpr),
  _export: kw("export"),
  _import: kw("import"),
  _null: kw("null", startsExpr),
  _true: kw("true", startsExpr),
  _false: kw("false", startsExpr),
  _in: kw("in", {beforeExpr: true, binop: 7}),
  _instanceof: kw("instanceof", {beforeExpr: true, binop: 7}),
  _typeof: kw("typeof", {beforeExpr: true, prefix: true, startsExpr: true}),
  _void: kw("void", {beforeExpr: true, prefix: true, startsExpr: true}),
  _delete: kw("delete", {beforeExpr: true, prefix: true, startsExpr: true})
};

// Matches a whole line break (where CRLF is considered a single
// line break). Used to count lines.

var lineBreak = /\r\n?|\n|\u2028|\u2029/;
var lineBreakG = new RegExp(lineBreak.source, "g");

function isNewLine(code, ecma2019String) {
  return code === 10 || code === 13 || (!ecma2019String && (code === 0x2028 || code === 0x2029))
}

var nonASCIIwhitespace = /[\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]/;

var skipWhiteSpace = /(?:\s|\/\/.*|\/\*[^]*?\*\/)*/g;

var ref = Object.prototype;
var hasOwnProperty = ref.hasOwnProperty;
var toString = ref.toString;

// Checks if an object has a property.

function has(obj, propName) {
  return hasOwnProperty.call(obj, propName)
}

var isArray = Array.isArray || (function (obj) { return (
  toString.call(obj) === "[object Array]"
); });

function wordsRegexp(words) {
  return new RegExp("^(?:" + words.replace(/ /g, "|") + ")$")
}

// These are used when `options.locations` is on, for the
// `startLoc` and `endLoc` properties.

var Position = function Position(line, col) {
  this.line = line;
  this.column = col;
};

Position.prototype.offset = function offset (n) {
  return new Position(this.line, this.column + n)
};

var SourceLocation = function SourceLocation(p, start, end) {
  this.start = start;
  this.end = end;
  if (p.sourceFile !== null) { this.source = p.sourceFile; }
};

// The `getLineInfo` function is mostly useful when the
// `locations` option is off (for performance reasons) and you
// want to find the line/column position for a given character
// offset. `input` should be the code string that the offset refers
// into.

function getLineInfo(input, offset) {
  for (var line = 1, cur = 0;;) {
    lineBreakG.lastIndex = cur;
    var match = lineBreakG.exec(input);
    if (match && match.index < offset) {
      ++line;
      cur = match.index + match[0].length;
    } else {
      return new Position(line, offset - cur)
    }
  }
}

// A second optional argument can be given to further configure
// the parser process. These options are recognized:

var defaultOptions = {
  // `ecmaVersion` indicates the ECMAScript version to parse. Must be
  // either 3, 5, 6 (2015), 7 (2016), 8 (2017), 9 (2018), or 10
  // (2019). This influences support for strict mode, the set of
  // reserved words, and support for new syntax features. The default
  // is 9.
  ecmaVersion: 9,
  // `sourceType` indicates the mode the code should be parsed in.
  // Can be either `"script"` or `"module"`. This influences global
  // strict mode and parsing of `import` and `export` declarations.
  sourceType: "script",
  // `onInsertedSemicolon` can be a callback that will be called
  // when a semicolon is automatically inserted. It will be passed
  // the position of the comma as an offset, and if `locations` is
  // enabled, it is given the location as a `{line, column}` object
  // as second argument.
  onInsertedSemicolon: null,
  // `onTrailingComma` is similar to `onInsertedSemicolon`, but for
  // trailing commas.
  onTrailingComma: null,
  // By default, reserved words are only enforced if ecmaVersion >= 5.
  // Set `allowReserved` to a boolean value to explicitly turn this on
  // an off. When this option has the value "never", reserved words
  // and keywords can also not be used as property names.
  allowReserved: null,
  // When enabled, a return at the top level is not considered an
  // error.
  allowReturnOutsideFunction: false,
  // When enabled, import/export statements are not constrained to
  // appearing at the top of the program.
  allowImportExportEverywhere: false,
  // When enabled, await identifiers are allowed to appear at the top-level scope,
  // but they are still not allowed in non-async functions.
  allowAwaitOutsideFunction: false,
  // When enabled, hashbang directive in the beginning of file
  // is allowed and treated as a line comment.
  allowHashBang: false,
  // When `locations` is on, `loc` properties holding objects with
  // `start` and `end` properties in `{line, column}` form (with
  // line being 1-based and column 0-based) will be attached to the
  // nodes.
  locations: false,
  // A function can be passed as `onToken` option, which will
  // cause Acorn to call that function with object in the same
  // format as tokens returned from `tokenizer().getToken()`. Note
  // that you are not allowed to call the parser from the
  // callback—that will corrupt its internal state.
  onToken: null,
  // A function can be passed as `onComment` option, which will
  // cause Acorn to call that function with `(block, text, start,
  // end)` parameters whenever a comment is skipped. `block` is a
  // boolean indicating whether this is a block (`/* */`) comment,
  // `text` is the content of the comment, and `start` and `end` are
  // character offsets that denote the start and end of the comment.
  // When the `locations` option is on, two more parameters are
  // passed, the full `{line, column}` locations of the start and
  // end of the comments. Note that you are not allowed to call the
  // parser from the callback—that will corrupt its internal state.
  onComment: null,
  // Nodes have their start and end characters offsets recorded in
  // `start` and `end` properties (directly on the node, rather than
  // the `loc` object, which holds line/column data. To also add a
  // [semi-standardized][range] `range` property holding a `[start,
  // end]` array with the same numbers, set the `ranges` option to
  // `true`.
  //
  // [range]: https://bugzilla.mozilla.org/show_bug.cgi?id=745678
  ranges: false,
  // It is possible to parse multiple files into a single AST by
  // passing the tree produced by parsing the first file as
  // `program` option in subsequent parses. This will add the
  // toplevel forms of the parsed file to the `Program` (top) node
  // of an existing parse tree.
  program: null,
  // When `locations` is on, you can pass this to record the source
  // file in every node's `loc` object.
  sourceFile: null,
  // This value, if given, is stored in every node, whether
  // `locations` is on or off.
  directSourceFile: null,
  // When enabled, parenthesized expressions are represented by
  // (non-standard) ParenthesizedExpression nodes
  preserveParens: false
};

// Interpret and default an options object

function getOptions(opts) {
  var options = {};

  for (var opt in defaultOptions)
    { options[opt] = opts && has(opts, opt) ? opts[opt] : defaultOptions[opt]; }

  if (options.ecmaVersion >= 2015)
    { options.ecmaVersion -= 2009; }

  if (options.allowReserved == null)
    { options.allowReserved = options.ecmaVersion < 5; }

  if (isArray(options.onToken)) {
    var tokens = options.onToken;
    options.onToken = function (token) { return tokens.push(token); };
  }
  if (isArray(options.onComment))
    { options.onComment = pushComment(options, options.onComment); }

  return options
}

function pushComment(options, array) {
  return function(block, text, start, end, startLoc, endLoc) {
    var comment = {
      type: block ? "Block" : "Line",
      value: text,
      start: start,
      end: end
    };
    if (options.locations)
      { comment.loc = new SourceLocation(this, startLoc, endLoc); }
    if (options.ranges)
      { comment.range = [start, end]; }
    array.push(comment);
  }
}

// Each scope gets a bitset that may contain these flags
var SCOPE_TOP = 1;
var SCOPE_FUNCTION = 2;
var SCOPE_VAR = SCOPE_TOP | SCOPE_FUNCTION;
var SCOPE_ASYNC = 4;
var SCOPE_GENERATOR = 8;
var SCOPE_ARROW = 16;
var SCOPE_SIMPLE_CATCH = 32;
var SCOPE_SUPER = 64;
var SCOPE_DIRECT_SUPER = 128;

function functionFlags(async, generator) {
  return SCOPE_FUNCTION | (async ? SCOPE_ASYNC : 0) | (generator ? SCOPE_GENERATOR : 0)
}

// Used in checkLVal and declareName to determine the type of a binding
var BIND_NONE = 0;
var BIND_VAR = 1;
var BIND_LEXICAL = 2;
var BIND_FUNCTION = 3;
var BIND_SIMPLE_CATCH = 4;
var BIND_OUTSIDE = 5; // Special case for function names as bound inside the function

var Parser = function Parser(options, input, startPos) {
  this.options = options = getOptions(options);
  this.sourceFile = options.sourceFile;
  this.keywords = wordsRegexp(keywords[options.ecmaVersion >= 6 ? 6 : 5]);
  var reserved = "";
  if (!options.allowReserved) {
    for (var v = options.ecmaVersion;; v--)
      { if (reserved = reservedWords[v]) { break } }
    if (options.sourceType === "module") { reserved += " await"; }
  }
  this.reservedWords = wordsRegexp(reserved);
  var reservedStrict = (reserved ? reserved + " " : "") + reservedWords.strict;
  this.reservedWordsStrict = wordsRegexp(reservedStrict);
  this.reservedWordsStrictBind = wordsRegexp(reservedStrict + " " + reservedWords.strictBind);
  this.input = String(input);

  // Used to signal to callers of `readWord1` whether the word
  // contained any escape sequences. This is needed because words with
  // escape sequences must not be interpreted as keywords.
  this.containsEsc = false;

  // Set up token state

  // The current position of the tokenizer in the input.
  if (startPos) {
    this.pos = startPos;
    this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
    this.curLine = this.input.slice(0, this.lineStart).split(lineBreak).length;
  } else {
    this.pos = this.lineStart = 0;
    this.curLine = 1;
  }

  // Properties of the current token:
  // Its type
  this.type = types.eof;
  // For tokens that include more information than their type, the value
  this.value = null;
  // Its start and end offset
  this.start = this.end = this.pos;
  // And, if locations are used, the {line, column} object
  // corresponding to those offsets
  this.startLoc = this.endLoc = this.curPosition();

  // Position information for the previous token
  this.lastTokEndLoc = this.lastTokStartLoc = null;
  this.lastTokStart = this.lastTokEnd = this.pos;

  // The context stack is used to superficially track syntactic
  // context to predict whether a regular expression is allowed in a
  // given position.
  this.context = this.initialContext();
  this.exprAllowed = true;

  // Figure out if it's a module code.
  this.inModule = options.sourceType === "module";
  this.strict = this.inModule || this.strictDirective(this.pos);

  // Used to signify the start of a potential arrow function
  this.potentialArrowAt = -1;

  // Positions to delayed-check that yield/await does not exist in default parameters.
  this.yieldPos = this.awaitPos = this.awaitIdentPos = 0;
  // Labels in scope.
  this.labels = [];
  // Thus-far undefined exports.
  this.undefinedExports = {};

  // If enabled, skip leading hashbang line.
  if (this.pos === 0 && options.allowHashBang && this.input.slice(0, 2) === "#!")
    { this.skipLineComment(2); }

  // Scope tracking for duplicate variable names (see scope.js)
  this.scopeStack = [];
  this.enterScope(SCOPE_TOP);

  // For RegExp validation
  this.regexpState = null;
};

var prototypeAccessors = { inFunction: { configurable: true },inGenerator: { configurable: true },inAsync: { configurable: true },allowSuper: { configurable: true },allowDirectSuper: { configurable: true },treatFunctionsAsVar: { configurable: true } };

Parser.prototype.parse = function parse () {
  var node = this.options.program || this.startNode();
  this.nextToken();
  return this.parseTopLevel(node)
};

prototypeAccessors.inFunction.get = function () { return (this.currentVarScope().flags & SCOPE_FUNCTION) > 0 };
prototypeAccessors.inGenerator.get = function () { return (this.currentVarScope().flags & SCOPE_GENERATOR) > 0 };
prototypeAccessors.inAsync.get = function () { return (this.currentVarScope().flags & SCOPE_ASYNC) > 0 };
prototypeAccessors.allowSuper.get = function () { return (this.currentThisScope().flags & SCOPE_SUPER) > 0 };
prototypeAccessors.allowDirectSuper.get = function () { return (this.currentThisScope().flags & SCOPE_DIRECT_SUPER) > 0 };
prototypeAccessors.treatFunctionsAsVar.get = function () { return this.treatFunctionsAsVarInScope(this.currentScope()) };

// Switch to a getter for 7.0.0.
Parser.prototype.inNonArrowFunction = function inNonArrowFunction () { return (this.currentThisScope().flags & SCOPE_FUNCTION) > 0 };

Parser.extend = function extend () {
    var plugins = [], len = arguments.length;
    while ( len-- ) plugins[ len ] = arguments[ len ];

  var cls = this;
  for (var i = 0; i < plugins.length; i++) { cls = plugins[i](cls); }
  return cls
};

Parser.parse = function parse (input, options) {
  return new this(options, input).parse()
};

Parser.parseExpressionAt = function parseExpressionAt (input, pos, options) {
  var parser = new this(options, input, pos);
  parser.nextToken();
  return parser.parseExpression()
};

Parser.tokenizer = function tokenizer (input, options) {
  return new this(options, input)
};

Object.defineProperties( Parser.prototype, prototypeAccessors );

var pp = Parser.prototype;

// ## Parser utilities

var literal = /^(?:'((?:\\.|[^'])*?)'|"((?:\\.|[^"])*?)")/;
pp.strictDirective = function(start) {
  var this$1 = this;

  for (;;) {
    // Try to find string literal.
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this$1.input)[0].length;
    var match = literal.exec(this$1.input.slice(start));
    if (!match) { return false }
    if ((match[1] || match[2]) === "use strict") { return true }
    start += match[0].length;

    // Skip semicolon, if any.
    skipWhiteSpace.lastIndex = start;
    start += skipWhiteSpace.exec(this$1.input)[0].length;
    if (this$1.input[start] === ";")
      { start++; }
  }
};

// Predicate that tests whether the next token is of the given
// type, and if yes, consumes it as a side effect.

pp.eat = function(type) {
  if (this.type === type) {
    this.next();
    return true
  } else {
    return false
  }
};

// Tests whether parsed token is a contextual keyword.

pp.isContextual = function(name) {
  return this.type === types.name && this.value === name && !this.containsEsc
};

// Consumes contextual keyword if possible.

pp.eatContextual = function(name) {
  if (!this.isContextual(name)) { return false }
  this.next();
  return true
};

// Asserts that following token is given contextual keyword.

pp.expectContextual = function(name) {
  if (!this.eatContextual(name)) { this.unexpected(); }
};

// Test whether a semicolon can be inserted at the current position.

pp.canInsertSemicolon = function() {
  return this.type === types.eof ||
    this.type === types.braceR ||
    lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
};

pp.insertSemicolon = function() {
  if (this.canInsertSemicolon()) {
    if (this.options.onInsertedSemicolon)
      { this.options.onInsertedSemicolon(this.lastTokEnd, this.lastTokEndLoc); }
    return true
  }
};

// Consume a semicolon, or, failing that, see if we are allowed to
// pretend that there is a semicolon at this position.

pp.semicolon = function() {
  if (!this.eat(types.semi) && !this.insertSemicolon()) { this.unexpected(); }
};

pp.afterTrailingComma = function(tokType, notNext) {
  if (this.type === tokType) {
    if (this.options.onTrailingComma)
      { this.options.onTrailingComma(this.lastTokStart, this.lastTokStartLoc); }
    if (!notNext)
      { this.next(); }
    return true
  }
};

// Expect a token of a given type. If found, consume it, otherwise,
// raise an unexpected token error.

pp.expect = function(type) {
  this.eat(type) || this.unexpected();
};

// Raise an unexpected token error.

pp.unexpected = function(pos) {
  this.raise(pos != null ? pos : this.start, "Unexpected token");
};

function DestructuringErrors() {
  this.shorthandAssign =
  this.trailingComma =
  this.parenthesizedAssign =
  this.parenthesizedBind =
  this.doubleProto =
    -1;
}

pp.checkPatternErrors = function(refDestructuringErrors, isAssign) {
  if (!refDestructuringErrors) { return }
  if (refDestructuringErrors.trailingComma > -1)
    { this.raiseRecoverable(refDestructuringErrors.trailingComma, "Comma is not permitted after the rest element"); }
  var parens = isAssign ? refDestructuringErrors.parenthesizedAssign : refDestructuringErrors.parenthesizedBind;
  if (parens > -1) { this.raiseRecoverable(parens, "Parenthesized pattern"); }
};

pp.checkExpressionErrors = function(refDestructuringErrors, andThrow) {
  if (!refDestructuringErrors) { return false }
  var shorthandAssign = refDestructuringErrors.shorthandAssign;
  var doubleProto = refDestructuringErrors.doubleProto;
  if (!andThrow) { return shorthandAssign >= 0 || doubleProto >= 0 }
  if (shorthandAssign >= 0)
    { this.raise(shorthandAssign, "Shorthand property assignments are valid only in destructuring patterns"); }
  if (doubleProto >= 0)
    { this.raiseRecoverable(doubleProto, "Redefinition of __proto__ property"); }
};

pp.checkYieldAwaitInDefaultParams = function() {
  if (this.yieldPos && (!this.awaitPos || this.yieldPos < this.awaitPos))
    { this.raise(this.yieldPos, "Yield expression cannot be a default value"); }
  if (this.awaitPos)
    { this.raise(this.awaitPos, "Await expression cannot be a default value"); }
};

pp.isSimpleAssignTarget = function(expr) {
  if (expr.type === "ParenthesizedExpression")
    { return this.isSimpleAssignTarget(expr.expression) }
  return expr.type === "Identifier" || expr.type === "MemberExpression"
};

var pp$1 = Parser.prototype;

// ### Statement parsing

// Parse a program. Initializes the parser, reads any number of
// statements, and wraps them in a Program node.  Optionally takes a
// `program` argument.  If present, the statements will be appended
// to its body instead of creating a new node.

pp$1.parseTopLevel = function(node) {
  var this$1 = this;

  var exports = {};
  if (!node.body) { node.body = []; }
  while (this.type !== types.eof) {
    var stmt = this$1.parseStatement(null, true, exports);
    node.body.push(stmt);
  }
  if (this.inModule)
    { for (var i = 0, list = Object.keys(this$1.undefinedExports); i < list.length; i += 1)
      {
        var name = list[i];

        this$1.raiseRecoverable(this$1.undefinedExports[name].start, ("Export '" + name + "' is not defined"));
      } }
  this.adaptDirectivePrologue(node.body);
  this.next();
  if (this.options.ecmaVersion >= 6) {
    node.sourceType = this.options.sourceType;
  }
  return this.finishNode(node, "Program")
};

var loopLabel = {kind: "loop"};
var switchLabel = {kind: "switch"};

pp$1.isLet = function(context) {
  if (this.options.ecmaVersion < 6 || !this.isContextual("let")) { return false }
  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length, nextCh = this.input.charCodeAt(next);
  // For ambiguous cases, determine if a LexicalDeclaration (or only a
  // Statement) is allowed here. If context is not empty then only a Statement
  // is allowed. However, `let [` is an explicit negative lookahead for
  // ExpressionStatement, so special-case it first.
  if (nextCh === 91) { return true } // '['
  if (context) { return false }

  if (nextCh === 123) { return true } // '{'
  if (isIdentifierStart(nextCh, true)) {
    var pos = next + 1;
    while (isIdentifierChar(this.input.charCodeAt(pos), true)) { ++pos; }
    var ident = this.input.slice(next, pos);
    if (!keywordRelationalOperator.test(ident)) { return true }
  }
  return false
};

// check 'async [no LineTerminator here] function'
// - 'async /*foo*/ function' is OK.
// - 'async /*\n*/ function' is invalid.
pp$1.isAsyncFunction = function() {
  if (this.options.ecmaVersion < 8 || !this.isContextual("async"))
    { return false }

  skipWhiteSpace.lastIndex = this.pos;
  var skip = skipWhiteSpace.exec(this.input);
  var next = this.pos + skip[0].length;
  return !lineBreak.test(this.input.slice(this.pos, next)) &&
    this.input.slice(next, next + 8) === "function" &&
    (next + 8 === this.input.length || !isIdentifierChar(this.input.charAt(next + 8)))
};

// Parse a single statement.
//
// If expecting a statement and finding a slash operator, parse a
// regular expression literal. This is to handle cases like
// `if (foo) /blah/.exec(foo)`, where looking at the previous token
// does not help.

pp$1.parseStatement = function(context, topLevel, exports) {
  var starttype = this.type, node = this.startNode(), kind;

  if (this.isLet(context)) {
    starttype = types._var;
    kind = "let";
  }

  // Most types of statements are recognized by the keyword they
  // start with. Many are trivial to parse, some require a bit of
  // complexity.

  switch (starttype) {
  case types._break: case types._continue: return this.parseBreakContinueStatement(node, starttype.keyword)
  case types._debugger: return this.parseDebuggerStatement(node)
  case types._do: return this.parseDoStatement(node)
  case types._for: return this.parseForStatement(node)
  case types._function:
    // Function as sole body of either an if statement or a labeled statement
    // works, but not when it is part of a labeled statement that is the sole
    // body of an if statement.
    if ((context && (this.strict || context !== "if" && context !== "label")) && this.options.ecmaVersion >= 6) { this.unexpected(); }
    return this.parseFunctionStatement(node, false, !context)
  case types._class:
    if (context) { this.unexpected(); }
    return this.parseClass(node, true)
  case types._if: return this.parseIfStatement(node)
  case types._return: return this.parseReturnStatement(node)
  case types._switch: return this.parseSwitchStatement(node)
  case types._throw: return this.parseThrowStatement(node)
  case types._try: return this.parseTryStatement(node)
  case types._const: case types._var:
    kind = kind || this.value;
    if (context && kind !== "var") { this.unexpected(); }
    return this.parseVarStatement(node, kind)
  case types._while: return this.parseWhileStatement(node)
  case types._with: return this.parseWithStatement(node)
  case types.braceL: return this.parseBlock(true, node)
  case types.semi: return this.parseEmptyStatement(node)
  case types._export:
  case types._import:
    if (!this.options.allowImportExportEverywhere) {
      if (!topLevel)
        { this.raise(this.start, "'import' and 'export' may only appear at the top level"); }
      if (!this.inModule)
        { this.raise(this.start, "'import' and 'export' may appear only with 'sourceType: module'"); }
    }
    return starttype === types._import ? this.parseImport(node) : this.parseExport(node, exports)

    // If the statement does not start with a statement keyword or a
    // brace, it's an ExpressionStatement or LabeledStatement. We
    // simply start parsing an expression, and afterwards, if the
    // next token is a colon and the expression was a simple
    // Identifier node, we switch to interpreting it as a label.
  default:
    if (this.isAsyncFunction()) {
      if (context) { this.unexpected(); }
      this.next();
      return this.parseFunctionStatement(node, true, !context)
    }

    var maybeName = this.value, expr = this.parseExpression();
    if (starttype === types.name && expr.type === "Identifier" && this.eat(types.colon))
      { return this.parseLabeledStatement(node, maybeName, expr, context) }
    else { return this.parseExpressionStatement(node, expr) }
  }
};

pp$1.parseBreakContinueStatement = function(node, keyword) {
  var this$1 = this;

  var isBreak = keyword === "break";
  this.next();
  if (this.eat(types.semi) || this.insertSemicolon()) { node.label = null; }
  else if (this.type !== types.name) { this.unexpected(); }
  else {
    node.label = this.parseIdent();
    this.semicolon();
  }

  // Verify that there is an actual destination to break or
  // continue to.
  var i = 0;
  for (; i < this.labels.length; ++i) {
    var lab = this$1.labels[i];
    if (node.label == null || lab.name === node.label.name) {
      if (lab.kind != null && (isBreak || lab.kind === "loop")) { break }
      if (node.label && isBreak) { break }
    }
  }
  if (i === this.labels.length) { this.raise(node.start, "Unsyntactic " + keyword); }
  return this.finishNode(node, isBreak ? "BreakStatement" : "ContinueStatement")
};

pp$1.parseDebuggerStatement = function(node) {
  this.next();
  this.semicolon();
  return this.finishNode(node, "DebuggerStatement")
};

pp$1.parseDoStatement = function(node) {
  this.next();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("do");
  this.labels.pop();
  this.expect(types._while);
  node.test = this.parseParenExpression();
  if (this.options.ecmaVersion >= 6)
    { this.eat(types.semi); }
  else
    { this.semicolon(); }
  return this.finishNode(node, "DoWhileStatement")
};

// Disambiguating between a `for` and a `for`/`in` or `for`/`of`
// loop is non-trivial. Basically, we have to parse the init `var`
// statement or expression, disallowing the `in` operator (see
// the second parameter to `parseExpression`), and then check
// whether the next token is `in` or `of`. When there is no init
// part (semicolon immediately after the opening parenthesis), it
// is a regular `for` loop.

pp$1.parseForStatement = function(node) {
  this.next();
  var awaitAt = (this.options.ecmaVersion >= 9 && (this.inAsync || (!this.inFunction && this.options.allowAwaitOutsideFunction)) && this.eatContextual("await")) ? this.lastTokStart : -1;
  this.labels.push(loopLabel);
  this.enterScope(0);
  this.expect(types.parenL);
  if (this.type === types.semi) {
    if (awaitAt > -1) { this.unexpected(awaitAt); }
    return this.parseFor(node, null)
  }
  var isLet = this.isLet();
  if (this.type === types._var || this.type === types._const || isLet) {
    var init$1 = this.startNode(), kind = isLet ? "let" : this.value;
    this.next();
    this.parseVar(init$1, true, kind);
    this.finishNode(init$1, "VariableDeclaration");
    if ((this.type === types._in || (this.options.ecmaVersion >= 6 && this.isContextual("of"))) && init$1.declarations.length === 1 &&
        !(kind !== "var" && init$1.declarations[0].init)) {
      if (this.options.ecmaVersion >= 9) {
        if (this.type === types._in) {
          if (awaitAt > -1) { this.unexpected(awaitAt); }
        } else { node.await = awaitAt > -1; }
      }
      return this.parseForIn(node, init$1)
    }
    if (awaitAt > -1) { this.unexpected(awaitAt); }
    return this.parseFor(node, init$1)
  }
  var refDestructuringErrors = new DestructuringErrors;
  var init = this.parseExpression(true, refDestructuringErrors);
  if (this.type === types._in || (this.options.ecmaVersion >= 6 && this.isContextual("of"))) {
    if (this.options.ecmaVersion >= 9) {
      if (this.type === types._in) {
        if (awaitAt > -1) { this.unexpected(awaitAt); }
      } else { node.await = awaitAt > -1; }
    }
    this.toAssignable(init, false, refDestructuringErrors);
    this.checkLVal(init);
    return this.parseForIn(node, init)
  } else {
    this.checkExpressionErrors(refDestructuringErrors, true);
  }
  if (awaitAt > -1) { this.unexpected(awaitAt); }
  return this.parseFor(node, init)
};

pp$1.parseFunctionStatement = function(node, isAsync, declarationPosition) {
  this.next();
  return this.parseFunction(node, FUNC_STATEMENT | (declarationPosition ? 0 : FUNC_HANGING_STATEMENT), false, isAsync)
};

pp$1.parseIfStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  // allow function declarations in branches, but only in non-strict mode
  node.consequent = this.parseStatement("if");
  node.alternate = this.eat(types._else) ? this.parseStatement("if") : null;
  return this.finishNode(node, "IfStatement")
};

pp$1.parseReturnStatement = function(node) {
  if (!this.inFunction && !this.options.allowReturnOutsideFunction)
    { this.raise(this.start, "'return' outside of function"); }
  this.next();

  // In `return` (and `break`/`continue`), the keywords with
  // optional arguments, we eagerly look for a semicolon or the
  // possibility to insert one.

  if (this.eat(types.semi) || this.insertSemicolon()) { node.argument = null; }
  else { node.argument = this.parseExpression(); this.semicolon(); }
  return this.finishNode(node, "ReturnStatement")
};

pp$1.parseSwitchStatement = function(node) {
  var this$1 = this;

  this.next();
  node.discriminant = this.parseParenExpression();
  node.cases = [];
  this.expect(types.braceL);
  this.labels.push(switchLabel);
  this.enterScope(0);

  // Statements under must be grouped (by label) in SwitchCase
  // nodes. `cur` is used to keep the node that we are currently
  // adding statements to.

  var cur;
  for (var sawDefault = false; this.type !== types.braceR;) {
    if (this$1.type === types._case || this$1.type === types._default) {
      var isCase = this$1.type === types._case;
      if (cur) { this$1.finishNode(cur, "SwitchCase"); }
      node.cases.push(cur = this$1.startNode());
      cur.consequent = [];
      this$1.next();
      if (isCase) {
        cur.test = this$1.parseExpression();
      } else {
        if (sawDefault) { this$1.raiseRecoverable(this$1.lastTokStart, "Multiple default clauses"); }
        sawDefault = true;
        cur.test = null;
      }
      this$1.expect(types.colon);
    } else {
      if (!cur) { this$1.unexpected(); }
      cur.consequent.push(this$1.parseStatement(null));
    }
  }
  this.exitScope();
  if (cur) { this.finishNode(cur, "SwitchCase"); }
  this.next(); // Closing brace
  this.labels.pop();
  return this.finishNode(node, "SwitchStatement")
};

pp$1.parseThrowStatement = function(node) {
  this.next();
  if (lineBreak.test(this.input.slice(this.lastTokEnd, this.start)))
    { this.raise(this.lastTokEnd, "Illegal newline after throw"); }
  node.argument = this.parseExpression();
  this.semicolon();
  return this.finishNode(node, "ThrowStatement")
};

// Reused empty array added for node fields that are always empty.

var empty = [];

pp$1.parseTryStatement = function(node) {
  this.next();
  node.block = this.parseBlock();
  node.handler = null;
  if (this.type === types._catch) {
    var clause = this.startNode();
    this.next();
    if (this.eat(types.parenL)) {
      clause.param = this.parseBindingAtom();
      var simple = clause.param.type === "Identifier";
      this.enterScope(simple ? SCOPE_SIMPLE_CATCH : 0);
      this.checkLVal(clause.param, simple ? BIND_SIMPLE_CATCH : BIND_LEXICAL);
      this.expect(types.parenR);
    } else {
      if (this.options.ecmaVersion < 10) { this.unexpected(); }
      clause.param = null;
      this.enterScope(0);
    }
    clause.body = this.parseBlock(false);
    this.exitScope();
    node.handler = this.finishNode(clause, "CatchClause");
  }
  node.finalizer = this.eat(types._finally) ? this.parseBlock() : null;
  if (!node.handler && !node.finalizer)
    { this.raise(node.start, "Missing catch or finally clause"); }
  return this.finishNode(node, "TryStatement")
};

pp$1.parseVarStatement = function(node, kind) {
  this.next();
  this.parseVar(node, false, kind);
  this.semicolon();
  return this.finishNode(node, "VariableDeclaration")
};

pp$1.parseWhileStatement = function(node) {
  this.next();
  node.test = this.parseParenExpression();
  this.labels.push(loopLabel);
  node.body = this.parseStatement("while");
  this.labels.pop();
  return this.finishNode(node, "WhileStatement")
};

pp$1.parseWithStatement = function(node) {
  if (this.strict) { this.raise(this.start, "'with' in strict mode"); }
  this.next();
  node.object = this.parseParenExpression();
  node.body = this.parseStatement("with");
  return this.finishNode(node, "WithStatement")
};

pp$1.parseEmptyStatement = function(node) {
  this.next();
  return this.finishNode(node, "EmptyStatement")
};

pp$1.parseLabeledStatement = function(node, maybeName, expr, context) {
  var this$1 = this;

  for (var i$1 = 0, list = this$1.labels; i$1 < list.length; i$1 += 1)
    {
    var label = list[i$1];

    if (label.name === maybeName)
      { this$1.raise(expr.start, "Label '" + maybeName + "' is already declared");
  } }
  var kind = this.type.isLoop ? "loop" : this.type === types._switch ? "switch" : null;
  for (var i = this.labels.length - 1; i >= 0; i--) {
    var label$1 = this$1.labels[i];
    if (label$1.statementStart === node.start) {
      // Update information about previous labels on this node
      label$1.statementStart = this$1.start;
      label$1.kind = kind;
    } else { break }
  }
  this.labels.push({name: maybeName, kind: kind, statementStart: this.start});
  node.body = this.parseStatement(context ? context.indexOf("label") === -1 ? context + "label" : context : "label");
  this.labels.pop();
  node.label = expr;
  return this.finishNode(node, "LabeledStatement")
};

pp$1.parseExpressionStatement = function(node, expr) {
  node.expression = expr;
  this.semicolon();
  return this.finishNode(node, "ExpressionStatement")
};

// Parse a semicolon-enclosed block of statements, handling `"use
// strict"` declarations when `allowStrict` is true (used for
// function bodies).

pp$1.parseBlock = function(createNewLexicalScope, node) {
  var this$1 = this;
  if ( createNewLexicalScope === void 0 ) createNewLexicalScope = true;
  if ( node === void 0 ) node = this.startNode();

  node.body = [];
  this.expect(types.braceL);
  if (createNewLexicalScope) { this.enterScope(0); }
  while (!this.eat(types.braceR)) {
    var stmt = this$1.parseStatement(null);
    node.body.push(stmt);
  }
  if (createNewLexicalScope) { this.exitScope(); }
  return this.finishNode(node, "BlockStatement")
};

// Parse a regular `for` loop. The disambiguation code in
// `parseStatement` will already have parsed the init statement or
// expression.

pp$1.parseFor = function(node, init) {
  node.init = init;
  this.expect(types.semi);
  node.test = this.type === types.semi ? null : this.parseExpression();
  this.expect(types.semi);
  node.update = this.type === types.parenR ? null : this.parseExpression();
  this.expect(types.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, "ForStatement")
};

// Parse a `for`/`in` and `for`/`of` loop, which are almost
// same from parser's perspective.

pp$1.parseForIn = function(node, init) {
  var type = this.type === types._in ? "ForInStatement" : "ForOfStatement";
  this.next();
  if (type === "ForInStatement") {
    if (init.type === "AssignmentPattern" ||
      (init.type === "VariableDeclaration" && init.declarations[0].init != null &&
       (this.strict || init.declarations[0].id.type !== "Identifier")))
      { this.raise(init.start, "Invalid assignment in for-in loop head"); }
  }
  node.left = init;
  node.right = type === "ForInStatement" ? this.parseExpression() : this.parseMaybeAssign();
  this.expect(types.parenR);
  node.body = this.parseStatement("for");
  this.exitScope();
  this.labels.pop();
  return this.finishNode(node, type)
};

// Parse a list of variable declarations.

pp$1.parseVar = function(node, isFor, kind) {
  var this$1 = this;

  node.declarations = [];
  node.kind = kind;
  for (;;) {
    var decl = this$1.startNode();
    this$1.parseVarId(decl, kind);
    if (this$1.eat(types.eq)) {
      decl.init = this$1.parseMaybeAssign(isFor);
    } else if (kind === "const" && !(this$1.type === types._in || (this$1.options.ecmaVersion >= 6 && this$1.isContextual("of")))) {
      this$1.unexpected();
    } else if (decl.id.type !== "Identifier" && !(isFor && (this$1.type === types._in || this$1.isContextual("of")))) {
      this$1.raise(this$1.lastTokEnd, "Complex binding patterns require an initialization value");
    } else {
      decl.init = null;
    }
    node.declarations.push(this$1.finishNode(decl, "VariableDeclarator"));
    if (!this$1.eat(types.comma)) { break }
  }
  return node
};

pp$1.parseVarId = function(decl, kind) {
  if ((kind === "const" || kind === "let") && this.isContextual("let")) {
    this.raiseRecoverable(this.start, "let is disallowed as a lexically bound name");
  }
  decl.id = this.parseBindingAtom();
  this.checkLVal(decl.id, kind === "var" ? BIND_VAR : BIND_LEXICAL, false);
};

var FUNC_STATEMENT = 1;
var FUNC_HANGING_STATEMENT = 2;
var FUNC_NULLABLE_ID = 4;

// Parse a function declaration or literal (depending on the
// `statement & FUNC_STATEMENT`).

// Remove `allowExpressionBody` for 7.0.0, as it is only called with false
pp$1.parseFunction = function(node, statement, allowExpressionBody, isAsync) {
  this.initFunction(node);
  if (this.options.ecmaVersion >= 9 || this.options.ecmaVersion >= 6 && !isAsync) {
    if (this.type === types.star && (statement & FUNC_HANGING_STATEMENT))
      { this.unexpected(); }
    node.generator = this.eat(types.star);
  }
  if (this.options.ecmaVersion >= 8)
    { node.async = !!isAsync; }

  if (statement & FUNC_STATEMENT) {
    node.id = (statement & FUNC_NULLABLE_ID) && this.type !== types.name ? null : this.parseIdent();
    if (node.id && !(statement & FUNC_HANGING_STATEMENT))
      // If it is a regular function declaration in sloppy mode, then it is
      // subject to Annex B semantics (BIND_FUNCTION). Otherwise, the binding
      // mode depends on properties of the current scope (see
      // treatFunctionsAsVar).
      { this.checkLVal(node.id, (this.strict || node.generator || node.async) ? this.treatFunctionsAsVar ? BIND_VAR : BIND_LEXICAL : BIND_FUNCTION); }
  }

  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(node.async, node.generator));

  if (!(statement & FUNC_STATEMENT))
    { node.id = this.type === types.name ? this.parseIdent() : null; }

  this.parseFunctionParams(node);
  this.parseFunctionBody(node, allowExpressionBody, false);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, (statement & FUNC_STATEMENT) ? "FunctionDeclaration" : "FunctionExpression")
};

pp$1.parseFunctionParams = function(node) {
  this.expect(types.parenL);
  node.params = this.parseBindingList(types.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
};

// Parse a class declaration or literal (depending on the
// `isStatement` parameter).

pp$1.parseClass = function(node, isStatement) {
  var this$1 = this;

  this.next();

  // ecma-262 14.6 Class Definitions
  // A class definition is always strict mode code.
  var oldStrict = this.strict;
  this.strict = true;

  this.parseClassId(node, isStatement);
  this.parseClassSuper(node);
  var classBody = this.startNode();
  var hadConstructor = false;
  classBody.body = [];
  this.expect(types.braceL);
  while (!this.eat(types.braceR)) {
    var element = this$1.parseClassElement(node.superClass !== null);
    if (element) {
      classBody.body.push(element);
      if (element.type === "MethodDefinition" && element.kind === "constructor") {
        if (hadConstructor) { this$1.raise(element.start, "Duplicate constructor in the same class"); }
        hadConstructor = true;
      }
    }
  }
  node.body = this.finishNode(classBody, "ClassBody");
  this.strict = oldStrict;
  return this.finishNode(node, isStatement ? "ClassDeclaration" : "ClassExpression")
};

pp$1.parseClassElement = function(constructorAllowsSuper) {
  var this$1 = this;

  if (this.eat(types.semi)) { return null }

  var method = this.startNode();
  var tryContextual = function (k, noLineBreak) {
    if ( noLineBreak === void 0 ) noLineBreak = false;

    var start = this$1.start, startLoc = this$1.startLoc;
    if (!this$1.eatContextual(k)) { return false }
    if (this$1.type !== types.parenL && (!noLineBreak || !this$1.canInsertSemicolon())) { return true }
    if (method.key) { this$1.unexpected(); }
    method.computed = false;
    method.key = this$1.startNodeAt(start, startLoc);
    method.key.name = k;
    this$1.finishNode(method.key, "Identifier");
    return false
  };

  method.kind = "method";
  method.static = tryContextual("static");
  var isGenerator = this.eat(types.star);
  var isAsync = false;
  if (!isGenerator) {
    if (this.options.ecmaVersion >= 8 && tryContextual("async", true)) {
      isAsync = true;
      isGenerator = this.options.ecmaVersion >= 9 && this.eat(types.star);
    } else if (tryContextual("get")) {
      method.kind = "get";
    } else if (tryContextual("set")) {
      method.kind = "set";
    }
  }
  if (!method.key) { this.parsePropertyName(method); }
  var key = method.key;
  var allowsDirectSuper = false;
  if (!method.computed && !method.static && (key.type === "Identifier" && key.name === "constructor" ||
      key.type === "Literal" && key.value === "constructor")) {
    if (method.kind !== "method") { this.raise(key.start, "Constructor can't have get/set modifier"); }
    if (isGenerator) { this.raise(key.start, "Constructor can't be a generator"); }
    if (isAsync) { this.raise(key.start, "Constructor can't be an async method"); }
    method.kind = "constructor";
    allowsDirectSuper = constructorAllowsSuper;
  } else if (method.static && key.type === "Identifier" && key.name === "prototype") {
    this.raise(key.start, "Classes may not have a static property named prototype");
  }
  this.parseClassMethod(method, isGenerator, isAsync, allowsDirectSuper);
  if (method.kind === "get" && method.value.params.length !== 0)
    { this.raiseRecoverable(method.value.start, "getter should have no params"); }
  if (method.kind === "set" && method.value.params.length !== 1)
    { this.raiseRecoverable(method.value.start, "setter should have exactly one param"); }
  if (method.kind === "set" && method.value.params[0].type === "RestElement")
    { this.raiseRecoverable(method.value.params[0].start, "Setter cannot use rest params"); }
  return method
};

pp$1.parseClassMethod = function(method, isGenerator, isAsync, allowsDirectSuper) {
  method.value = this.parseMethod(isGenerator, isAsync, allowsDirectSuper);
  return this.finishNode(method, "MethodDefinition")
};

pp$1.parseClassId = function(node, isStatement) {
  if (this.type === types.name) {
    node.id = this.parseIdent();
    if (isStatement)
      { this.checkLVal(node.id, BIND_LEXICAL, false); }
  } else {
    if (isStatement === true)
      { this.unexpected(); }
    node.id = null;
  }
};

pp$1.parseClassSuper = function(node) {
  node.superClass = this.eat(types._extends) ? this.parseExprSubscripts() : null;
};

// Parses module export declaration.

pp$1.parseExport = function(node, exports) {
  var this$1 = this;

  this.next();
  // export * from '...'
  if (this.eat(types.star)) {
    this.expectContextual("from");
    if (this.type !== types.string) { this.unexpected(); }
    node.source = this.parseExprAtom();
    this.semicolon();
    return this.finishNode(node, "ExportAllDeclaration")
  }
  if (this.eat(types._default)) { // export default ...
    this.checkExport(exports, "default", this.lastTokStart);
    var isAsync;
    if (this.type === types._function || (isAsync = this.isAsyncFunction())) {
      var fNode = this.startNode();
      this.next();
      if (isAsync) { this.next(); }
      node.declaration = this.parseFunction(fNode, FUNC_STATEMENT | FUNC_NULLABLE_ID, false, isAsync);
    } else if (this.type === types._class) {
      var cNode = this.startNode();
      node.declaration = this.parseClass(cNode, "nullableID");
    } else {
      node.declaration = this.parseMaybeAssign();
      this.semicolon();
    }
    return this.finishNode(node, "ExportDefaultDeclaration")
  }
  // export var|const|let|function|class ...
  if (this.shouldParseExportStatement()) {
    node.declaration = this.parseStatement(null);
    if (node.declaration.type === "VariableDeclaration")
      { this.checkVariableExport(exports, node.declaration.declarations); }
    else
      { this.checkExport(exports, node.declaration.id.name, node.declaration.id.start); }
    node.specifiers = [];
    node.source = null;
  } else { // export { x, y as z } [from '...']
    node.declaration = null;
    node.specifiers = this.parseExportSpecifiers(exports);
    if (this.eatContextual("from")) {
      if (this.type !== types.string) { this.unexpected(); }
      node.source = this.parseExprAtom();
    } else {
      for (var i = 0, list = node.specifiers; i < list.length; i += 1) {
        // check for keywords used as local names
        var spec = list[i];

        this$1.checkUnreserved(spec.local);
        // check if export is defined
        this$1.checkLocalExport(spec.local);
      }

      node.source = null;
    }
    this.semicolon();
  }
  return this.finishNode(node, "ExportNamedDeclaration")
};

pp$1.checkExport = function(exports, name, pos) {
  if (!exports) { return }
  if (has(exports, name))
    { this.raiseRecoverable(pos, "Duplicate export '" + name + "'"); }
  exports[name] = true;
};

pp$1.checkPatternExport = function(exports, pat) {
  var this$1 = this;

  var type = pat.type;
  if (type === "Identifier")
    { this.checkExport(exports, pat.name, pat.start); }
  else if (type === "ObjectPattern")
    { for (var i = 0, list = pat.properties; i < list.length; i += 1)
      {
        var prop = list[i];

        this$1.checkPatternExport(exports, prop);
      } }
  else if (type === "ArrayPattern")
    { for (var i$1 = 0, list$1 = pat.elements; i$1 < list$1.length; i$1 += 1) {
      var elt = list$1[i$1];

        if (elt) { this$1.checkPatternExport(exports, elt); }
    } }
  else if (type === "Property")
    { this.checkPatternExport(exports, pat.value); }
  else if (type === "AssignmentPattern")
    { this.checkPatternExport(exports, pat.left); }
  else if (type === "RestElement")
    { this.checkPatternExport(exports, pat.argument); }
  else if (type === "ParenthesizedExpression")
    { this.checkPatternExport(exports, pat.expression); }
};

pp$1.checkVariableExport = function(exports, decls) {
  var this$1 = this;

  if (!exports) { return }
  for (var i = 0, list = decls; i < list.length; i += 1)
    {
    var decl = list[i];

    this$1.checkPatternExport(exports, decl.id);
  }
};

pp$1.shouldParseExportStatement = function() {
  return this.type.keyword === "var" ||
    this.type.keyword === "const" ||
    this.type.keyword === "class" ||
    this.type.keyword === "function" ||
    this.isLet() ||
    this.isAsyncFunction()
};

// Parses a comma-separated list of module exports.

pp$1.parseExportSpecifiers = function(exports) {
  var this$1 = this;

  var nodes = [], first = true;
  // export { x, y as z } [from '...']
  this.expect(types.braceL);
  while (!this.eat(types.braceR)) {
    if (!first) {
      this$1.expect(types.comma);
      if (this$1.afterTrailingComma(types.braceR)) { break }
    } else { first = false; }

    var node = this$1.startNode();
    node.local = this$1.parseIdent(true);
    node.exported = this$1.eatContextual("as") ? this$1.parseIdent(true) : node.local;
    this$1.checkExport(exports, node.exported.name, node.exported.start);
    nodes.push(this$1.finishNode(node, "ExportSpecifier"));
  }
  return nodes
};

// Parses import declaration.

pp$1.parseImport = function(node) {
  this.next();
  // import '...'
  if (this.type === types.string) {
    node.specifiers = empty;
    node.source = this.parseExprAtom();
  } else {
    node.specifiers = this.parseImportSpecifiers();
    this.expectContextual("from");
    node.source = this.type === types.string ? this.parseExprAtom() : this.unexpected();
  }
  this.semicolon();
  return this.finishNode(node, "ImportDeclaration")
};

// Parses a comma-separated list of module imports.

pp$1.parseImportSpecifiers = function() {
  var this$1 = this;

  var nodes = [], first = true;
  if (this.type === types.name) {
    // import defaultObj, { x, y as z } from '...'
    var node = this.startNode();
    node.local = this.parseIdent();
    this.checkLVal(node.local, BIND_LEXICAL);
    nodes.push(this.finishNode(node, "ImportDefaultSpecifier"));
    if (!this.eat(types.comma)) { return nodes }
  }
  if (this.type === types.star) {
    var node$1 = this.startNode();
    this.next();
    this.expectContextual("as");
    node$1.local = this.parseIdent();
    this.checkLVal(node$1.local, BIND_LEXICAL);
    nodes.push(this.finishNode(node$1, "ImportNamespaceSpecifier"));
    return nodes
  }
  this.expect(types.braceL);
  while (!this.eat(types.braceR)) {
    if (!first) {
      this$1.expect(types.comma);
      if (this$1.afterTrailingComma(types.braceR)) { break }
    } else { first = false; }

    var node$2 = this$1.startNode();
    node$2.imported = this$1.parseIdent(true);
    if (this$1.eatContextual("as")) {
      node$2.local = this$1.parseIdent();
    } else {
      this$1.checkUnreserved(node$2.imported);
      node$2.local = node$2.imported;
    }
    this$1.checkLVal(node$2.local, BIND_LEXICAL);
    nodes.push(this$1.finishNode(node$2, "ImportSpecifier"));
  }
  return nodes
};

// Set `ExpressionStatement#directive` property for directive prologues.
pp$1.adaptDirectivePrologue = function(statements) {
  for (var i = 0; i < statements.length && this.isDirectiveCandidate(statements[i]); ++i) {
    statements[i].directive = statements[i].expression.raw.slice(1, -1);
  }
};
pp$1.isDirectiveCandidate = function(statement) {
  return (
    statement.type === "ExpressionStatement" &&
    statement.expression.type === "Literal" &&
    typeof statement.expression.value === "string" &&
    // Reject parenthesized strings.
    (this.input[statement.start] === "\"" || this.input[statement.start] === "'")
  )
};

var pp$2 = Parser.prototype;

// Convert existing expression atom to assignable pattern
// if possible.

pp$2.toAssignable = function(node, isBinding, refDestructuringErrors) {
  var this$1 = this;

  if (this.options.ecmaVersion >= 6 && node) {
    switch (node.type) {
    case "Identifier":
      if (this.inAsync && node.name === "await")
        { this.raise(node.start, "Cannot use 'await' as identifier inside an async function"); }
      break

    case "ObjectPattern":
    case "ArrayPattern":
    case "RestElement":
      break

    case "ObjectExpression":
      node.type = "ObjectPattern";
      if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
      for (var i = 0, list = node.properties; i < list.length; i += 1) {
        var prop = list[i];

      this$1.toAssignable(prop, isBinding);
        // Early error:
        //   AssignmentRestProperty[Yield, Await] :
        //     `...` DestructuringAssignmentTarget[Yield, Await]
        //
        //   It is a Syntax Error if |DestructuringAssignmentTarget| is an |ArrayLiteral| or an |ObjectLiteral|.
        if (
          prop.type === "RestElement" &&
          (prop.argument.type === "ArrayPattern" || prop.argument.type === "ObjectPattern")
        ) {
          this$1.raise(prop.argument.start, "Unexpected token");
        }
      }
      break

    case "Property":
      // AssignmentProperty has type === "Property"
      if (node.kind !== "init") { this.raise(node.key.start, "Object pattern can't contain getter or setter"); }
      this.toAssignable(node.value, isBinding);
      break

    case "ArrayExpression":
      node.type = "ArrayPattern";
      if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
      this.toAssignableList(node.elements, isBinding);
      break

    case "SpreadElement":
      node.type = "RestElement";
      this.toAssignable(node.argument, isBinding);
      if (node.argument.type === "AssignmentPattern")
        { this.raise(node.argument.start, "Rest elements cannot have a default value"); }
      break

    case "AssignmentExpression":
      if (node.operator !== "=") { this.raise(node.left.end, "Only '=' operator can be used for specifying default value."); }
      node.type = "AssignmentPattern";
      delete node.operator;
      this.toAssignable(node.left, isBinding);
      // falls through to AssignmentPattern

    case "AssignmentPattern":
      break

    case "ParenthesizedExpression":
      this.toAssignable(node.expression, isBinding, refDestructuringErrors);
      break

    case "MemberExpression":
      if (!isBinding) { break }

    default:
      this.raise(node.start, "Assigning to rvalue");
    }
  } else if (refDestructuringErrors) { this.checkPatternErrors(refDestructuringErrors, true); }
  return node
};

// Convert list of expression atoms to binding list.

pp$2.toAssignableList = function(exprList, isBinding) {
  var this$1 = this;

  var end = exprList.length;
  for (var i = 0; i < end; i++) {
    var elt = exprList[i];
    if (elt) { this$1.toAssignable(elt, isBinding); }
  }
  if (end) {
    var last = exprList[end - 1];
    if (this.options.ecmaVersion === 6 && isBinding && last && last.type === "RestElement" && last.argument.type !== "Identifier")
      { this.unexpected(last.argument.start); }
  }
  return exprList
};

// Parses spread element.

pp$2.parseSpread = function(refDestructuringErrors) {
  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeAssign(false, refDestructuringErrors);
  return this.finishNode(node, "SpreadElement")
};

pp$2.parseRestBinding = function() {
  var node = this.startNode();
  this.next();

  // RestElement inside of a function parameter must be an identifier
  if (this.options.ecmaVersion === 6 && this.type !== types.name)
    { this.unexpected(); }

  node.argument = this.parseBindingAtom();

  return this.finishNode(node, "RestElement")
};

// Parses lvalue (assignable) atom.

pp$2.parseBindingAtom = function() {
  if (this.options.ecmaVersion >= 6) {
    switch (this.type) {
    case types.bracketL:
      var node = this.startNode();
      this.next();
      node.elements = this.parseBindingList(types.bracketR, true, true);
      return this.finishNode(node, "ArrayPattern")

    case types.braceL:
      return this.parseObj(true)
    }
  }
  return this.parseIdent()
};

pp$2.parseBindingList = function(close, allowEmpty, allowTrailingComma) {
  var this$1 = this;

  var elts = [], first = true;
  while (!this.eat(close)) {
    if (first) { first = false; }
    else { this$1.expect(types.comma); }
    if (allowEmpty && this$1.type === types.comma) {
      elts.push(null);
    } else if (allowTrailingComma && this$1.afterTrailingComma(close)) {
      break
    } else if (this$1.type === types.ellipsis) {
      var rest = this$1.parseRestBinding();
      this$1.parseBindingListItem(rest);
      elts.push(rest);
      if (this$1.type === types.comma) { this$1.raise(this$1.start, "Comma is not permitted after the rest element"); }
      this$1.expect(close);
      break
    } else {
      var elem = this$1.parseMaybeDefault(this$1.start, this$1.startLoc);
      this$1.parseBindingListItem(elem);
      elts.push(elem);
    }
  }
  return elts
};

pp$2.parseBindingListItem = function(param) {
  return param
};

// Parses assignment pattern around given atom if possible.

pp$2.parseMaybeDefault = function(startPos, startLoc, left) {
  left = left || this.parseBindingAtom();
  if (this.options.ecmaVersion < 6 || !this.eat(types.eq)) { return left }
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.right = this.parseMaybeAssign();
  return this.finishNode(node, "AssignmentPattern")
};

// Verify that a node is an lval — something that can be assigned
// to.
// bindingType can be either:
// 'var' indicating that the lval creates a 'var' binding
// 'let' indicating that the lval creates a lexical ('let' or 'const') binding
// 'none' indicating that the binding should be checked for illegal identifiers, but not for duplicate references

pp$2.checkLVal = function(expr, bindingType, checkClashes) {
  var this$1 = this;
  if ( bindingType === void 0 ) bindingType = BIND_NONE;

  switch (expr.type) {
  case "Identifier":
    if (this.strict && this.reservedWordsStrictBind.test(expr.name))
      { this.raiseRecoverable(expr.start, (bindingType ? "Binding " : "Assigning to ") + expr.name + " in strict mode"); }
    if (checkClashes) {
      if (has(checkClashes, expr.name))
        { this.raiseRecoverable(expr.start, "Argument name clash"); }
      checkClashes[expr.name] = true;
    }
    if (bindingType !== BIND_NONE && bindingType !== BIND_OUTSIDE) { this.declareName(expr.name, bindingType, expr.start); }
    break

  case "MemberExpression":
    if (bindingType) { this.raiseRecoverable(expr.start, "Binding member expression"); }
    break

  case "ObjectPattern":
    for (var i = 0, list = expr.properties; i < list.length; i += 1)
      {
    var prop = list[i];

    this$1.checkLVal(prop, bindingType, checkClashes);
  }
    break

  case "Property":
    // AssignmentProperty has type === "Property"
    this.checkLVal(expr.value, bindingType, checkClashes);
    break

  case "ArrayPattern":
    for (var i$1 = 0, list$1 = expr.elements; i$1 < list$1.length; i$1 += 1) {
      var elem = list$1[i$1];

    if (elem) { this$1.checkLVal(elem, bindingType, checkClashes); }
    }
    break

  case "AssignmentPattern":
    this.checkLVal(expr.left, bindingType, checkClashes);
    break

  case "RestElement":
    this.checkLVal(expr.argument, bindingType, checkClashes);
    break

  case "ParenthesizedExpression":
    this.checkLVal(expr.expression, bindingType, checkClashes);
    break

  default:
    this.raise(expr.start, (bindingType ? "Binding" : "Assigning to") + " rvalue");
  }
};

// A recursive descent parser operates by defining functions for all
// syntactic elements, and recursively calling those, each function
// advancing the input stream and returning an AST node. Precedence
// of constructs (for example, the fact that `!x[1]` means `!(x[1])`
// instead of `(!x)[1]` is handled by the fact that the parser
// function that parses unary prefix operators is called first, and
// in turn calls the function that parses `[]` subscripts — that
// way, it'll receive the node for `x[1]` already parsed, and wraps
// *that* in the unary operator node.
//
// Acorn uses an [operator precedence parser][opp] to handle binary
// operator precedence, because it is much more compact than using
// the technique outlined above, which uses different, nesting
// functions to specify precedence, for all of the ten binary
// precedence levels that JavaScript defines.
//
// [opp]: http://en.wikipedia.org/wiki/Operator-precedence_parser

var pp$3 = Parser.prototype;

// Check if property name clashes with already added.
// Object/class getters and setters are not allowed to clash —
// either with each other or with an init property — and in
// strict mode, init properties are also not allowed to be repeated.

pp$3.checkPropClash = function(prop, propHash, refDestructuringErrors) {
  if (this.options.ecmaVersion >= 9 && prop.type === "SpreadElement")
    { return }
  if (this.options.ecmaVersion >= 6 && (prop.computed || prop.method || prop.shorthand))
    { return }
  var key = prop.key;
  var name;
  switch (key.type) {
  case "Identifier": name = key.name; break
  case "Literal": name = String(key.value); break
  default: return
  }
  var kind = prop.kind;
  if (this.options.ecmaVersion >= 6) {
    if (name === "__proto__" && kind === "init") {
      if (propHash.proto) {
        if (refDestructuringErrors && refDestructuringErrors.doubleProto < 0) { refDestructuringErrors.doubleProto = key.start; }
        // Backwards-compat kludge. Can be removed in version 6.0
        else { this.raiseRecoverable(key.start, "Redefinition of __proto__ property"); }
      }
      propHash.proto = true;
    }
    return
  }
  name = "$" + name;
  var other = propHash[name];
  if (other) {
    var redefinition;
    if (kind === "init") {
      redefinition = this.strict && other.init || other.get || other.set;
    } else {
      redefinition = other.init || other[kind];
    }
    if (redefinition)
      { this.raiseRecoverable(key.start, "Redefinition of property"); }
  } else {
    other = propHash[name] = {
      init: false,
      get: false,
      set: false
    };
  }
  other[kind] = true;
};

// ### Expression parsing

// These nest, from the most general expression type at the top to
// 'atomic', nondivisible expression types at the bottom. Most of
// the functions will simply let the function(s) below them parse,
// and, *if* the syntactic construct they handle is present, wrap
// the AST node that the inner parser gave them in another node.

// Parse a full expression. The optional arguments are used to
// forbid the `in` operator (in for loops initalization expressions)
// and provide reference for storing '=' operator inside shorthand
// property assignment in contexts where both object expression
// and object pattern might appear (so it's possible to raise
// delayed syntax error at correct position).

pp$3.parseExpression = function(noIn, refDestructuringErrors) {
  var this$1 = this;

  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeAssign(noIn, refDestructuringErrors);
  if (this.type === types.comma) {
    var node = this.startNodeAt(startPos, startLoc);
    node.expressions = [expr];
    while (this.eat(types.comma)) { node.expressions.push(this$1.parseMaybeAssign(noIn, refDestructuringErrors)); }
    return this.finishNode(node, "SequenceExpression")
  }
  return expr
};

// Parse an assignment expression. This includes applications of
// operators like `+=`.

pp$3.parseMaybeAssign = function(noIn, refDestructuringErrors, afterLeftParse) {
  if (this.isContextual("yield")) {
    if (this.inGenerator) { return this.parseYield(noIn) }
    // The tokenizer will assume an expression is allowed after
    // `yield`, but this isn't that kind of yield
    else { this.exprAllowed = false; }
  }

  var ownDestructuringErrors = false, oldParenAssign = -1, oldTrailingComma = -1, oldShorthandAssign = -1;
  if (refDestructuringErrors) {
    oldParenAssign = refDestructuringErrors.parenthesizedAssign;
    oldTrailingComma = refDestructuringErrors.trailingComma;
    oldShorthandAssign = refDestructuringErrors.shorthandAssign;
    refDestructuringErrors.parenthesizedAssign = refDestructuringErrors.trailingComma = refDestructuringErrors.shorthandAssign = -1;
  } else {
    refDestructuringErrors = new DestructuringErrors;
    ownDestructuringErrors = true;
  }

  var startPos = this.start, startLoc = this.startLoc;
  if (this.type === types.parenL || this.type === types.name)
    { this.potentialArrowAt = this.start; }
  var left = this.parseMaybeConditional(noIn, refDestructuringErrors);
  if (afterLeftParse) { left = afterLeftParse.call(this, left, startPos, startLoc); }
  if (this.type.isAssign) {
    var node = this.startNodeAt(startPos, startLoc);
    node.operator = this.value;
    node.left = this.type === types.eq ? this.toAssignable(left, false, refDestructuringErrors) : left;
    if (!ownDestructuringErrors) { DestructuringErrors.call(refDestructuringErrors); }
    refDestructuringErrors.shorthandAssign = -1; // reset because shorthand default was used correctly
    this.checkLVal(left);
    this.next();
    node.right = this.parseMaybeAssign(noIn);
    return this.finishNode(node, "AssignmentExpression")
  } else {
    if (ownDestructuringErrors) { this.checkExpressionErrors(refDestructuringErrors, true); }
  }
  if (oldParenAssign > -1) { refDestructuringErrors.parenthesizedAssign = oldParenAssign; }
  if (oldTrailingComma > -1) { refDestructuringErrors.trailingComma = oldTrailingComma; }
  if (oldShorthandAssign > -1) { refDestructuringErrors.shorthandAssign = oldShorthandAssign; }
  return left
};

// Parse a ternary conditional (`?:`) operator.

pp$3.parseMaybeConditional = function(noIn, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprOps(noIn, refDestructuringErrors);
  if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
  if (this.eat(types.question)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.test = expr;
    node.consequent = this.parseMaybeAssign();
    this.expect(types.colon);
    node.alternate = this.parseMaybeAssign(noIn);
    return this.finishNode(node, "ConditionalExpression")
  }
  return expr
};

// Start the precedence parser.

pp$3.parseExprOps = function(noIn, refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseMaybeUnary(refDestructuringErrors, false);
  if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
  return expr.start === startPos && expr.type === "ArrowFunctionExpression" ? expr : this.parseExprOp(expr, startPos, startLoc, -1, noIn)
};

// Parse binary operators with the operator precedence parsing
// algorithm. `left` is the left-hand side of the operator.
// `minPrec` provides context that allows the function to stop and
// defer further parser to one of its callers when it encounters an
// operator that has a lower precedence than the set it is parsing.

pp$3.parseExprOp = function(left, leftStartPos, leftStartLoc, minPrec, noIn) {
  var prec = this.type.binop;
  if (prec != null && (!noIn || this.type !== types._in)) {
    if (prec > minPrec) {
      var logical = this.type === types.logicalOR || this.type === types.logicalAND;
      var op = this.value;
      this.next();
      var startPos = this.start, startLoc = this.startLoc;
      var right = this.parseExprOp(this.parseMaybeUnary(null, false), startPos, startLoc, prec, noIn);
      var node = this.buildBinary(leftStartPos, leftStartLoc, left, right, op, logical);
      return this.parseExprOp(node, leftStartPos, leftStartLoc, minPrec, noIn)
    }
  }
  return left
};

pp$3.buildBinary = function(startPos, startLoc, left, right, op, logical) {
  var node = this.startNodeAt(startPos, startLoc);
  node.left = left;
  node.operator = op;
  node.right = right;
  return this.finishNode(node, logical ? "LogicalExpression" : "BinaryExpression")
};

// Parse unary operators, both prefix and postfix.

pp$3.parseMaybeUnary = function(refDestructuringErrors, sawUnary) {
  var this$1 = this;

  var startPos = this.start, startLoc = this.startLoc, expr;
  if (this.isContextual("await") && (this.inAsync || (!this.inFunction && this.options.allowAwaitOutsideFunction))) {
    expr = this.parseAwait();
    sawUnary = true;
  } else if (this.type.prefix) {
    var node = this.startNode(), update = this.type === types.incDec;
    node.operator = this.value;
    node.prefix = true;
    this.next();
    node.argument = this.parseMaybeUnary(null, true);
    this.checkExpressionErrors(refDestructuringErrors, true);
    if (update) { this.checkLVal(node.argument); }
    else if (this.strict && node.operator === "delete" &&
             node.argument.type === "Identifier")
      { this.raiseRecoverable(node.start, "Deleting local variable in strict mode"); }
    else { sawUnary = true; }
    expr = this.finishNode(node, update ? "UpdateExpression" : "UnaryExpression");
  } else {
    expr = this.parseExprSubscripts(refDestructuringErrors);
    if (this.checkExpressionErrors(refDestructuringErrors)) { return expr }
    while (this.type.postfix && !this.canInsertSemicolon()) {
      var node$1 = this$1.startNodeAt(startPos, startLoc);
      node$1.operator = this$1.value;
      node$1.prefix = false;
      node$1.argument = expr;
      this$1.checkLVal(expr);
      this$1.next();
      expr = this$1.finishNode(node$1, "UpdateExpression");
    }
  }

  if (!sawUnary && this.eat(types.starstar))
    { return this.buildBinary(startPos, startLoc, expr, this.parseMaybeUnary(null, false), "**", false) }
  else
    { return expr }
};

// Parse call, dot, and `[]`-subscript expressions.

pp$3.parseExprSubscripts = function(refDestructuringErrors) {
  var startPos = this.start, startLoc = this.startLoc;
  var expr = this.parseExprAtom(refDestructuringErrors);
  var skipArrowSubscripts = expr.type === "ArrowFunctionExpression" && this.input.slice(this.lastTokStart, this.lastTokEnd) !== ")";
  if (this.checkExpressionErrors(refDestructuringErrors) || skipArrowSubscripts) { return expr }
  var result = this.parseSubscripts(expr, startPos, startLoc);
  if (refDestructuringErrors && result.type === "MemberExpression") {
    if (refDestructuringErrors.parenthesizedAssign >= result.start) { refDestructuringErrors.parenthesizedAssign = -1; }
    if (refDestructuringErrors.parenthesizedBind >= result.start) { refDestructuringErrors.parenthesizedBind = -1; }
  }
  return result
};

pp$3.parseSubscripts = function(base, startPos, startLoc, noCalls) {
  var this$1 = this;

  var maybeAsyncArrow = this.options.ecmaVersion >= 8 && base.type === "Identifier" && base.name === "async" &&
      this.lastTokEnd === base.end && !this.canInsertSemicolon() && this.input.slice(base.start, base.end) === "async";
  while (true) {
    var element = this$1.parseSubscript(base, startPos, startLoc, noCalls, maybeAsyncArrow);
    if (element === base || element.type === "ArrowFunctionExpression") { return element }
    base = element;
  }
};

pp$3.parseSubscript = function(base, startPos, startLoc, noCalls, maybeAsyncArrow) {
  var computed = this.eat(types.bracketL);
  if (computed || this.eat(types.dot)) {
    var node = this.startNodeAt(startPos, startLoc);
    node.object = base;
    node.property = computed ? this.parseExpression() : this.parseIdent(true);
    node.computed = !!computed;
    if (computed) { this.expect(types.bracketR); }
    base = this.finishNode(node, "MemberExpression");
  } else if (!noCalls && this.eat(types.parenL)) {
    var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;
    this.yieldPos = 0;
    this.awaitPos = 0;
    this.awaitIdentPos = 0;
    var exprList = this.parseExprList(types.parenR, this.options.ecmaVersion >= 8, false, refDestructuringErrors);
    if (maybeAsyncArrow && !this.canInsertSemicolon() && this.eat(types.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      if (this.awaitIdentPos > 0)
        { this.raise(this.awaitIdentPos, "Cannot use 'await' as identifier inside an async function"); }
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      this.awaitIdentPos = oldAwaitIdentPos;
      return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList, true)
    }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;
    this.awaitIdentPos = oldAwaitIdentPos || this.awaitIdentPos;
    var node$1 = this.startNodeAt(startPos, startLoc);
    node$1.callee = base;
    node$1.arguments = exprList;
    base = this.finishNode(node$1, "CallExpression");
  } else if (this.type === types.backQuote) {
    var node$2 = this.startNodeAt(startPos, startLoc);
    node$2.tag = base;
    node$2.quasi = this.parseTemplate({isTagged: true});
    base = this.finishNode(node$2, "TaggedTemplateExpression");
  }
  return base
};

// Parse an atomic expression — either a single token that is an
// expression, an expression started by a keyword like `function` or
// `new`, or an expression wrapped in punctuation like `()`, `[]`,
// or `{}`.

pp$3.parseExprAtom = function(refDestructuringErrors) {
  // If a division operator appears in an expression position, the
  // tokenizer got confused, and we force it to read a regexp instead.
  if (this.type === types.slash) { this.readRegexp(); }

  var node, canBeArrow = this.potentialArrowAt === this.start;
  switch (this.type) {
  case types._super:
    if (!this.allowSuper)
      { this.raise(this.start, "'super' keyword outside a method"); }
    node = this.startNode();
    this.next();
    if (this.type === types.parenL && !this.allowDirectSuper)
      { this.raise(node.start, "super() call outside constructor of a subclass"); }
    // The `super` keyword can appear at below:
    // SuperProperty:
    //     super [ Expression ]
    //     super . IdentifierName
    // SuperCall:
    //     super Arguments
    if (this.type !== types.dot && this.type !== types.bracketL && this.type !== types.parenL)
      { this.unexpected(); }
    return this.finishNode(node, "Super")

  case types._this:
    node = this.startNode();
    this.next();
    return this.finishNode(node, "ThisExpression")

  case types.name:
    var startPos = this.start, startLoc = this.startLoc, containsEsc = this.containsEsc;
    var id = this.parseIdent(false);
    if (this.options.ecmaVersion >= 8 && !containsEsc && id.name === "async" && !this.canInsertSemicolon() && this.eat(types._function))
      { return this.parseFunction(this.startNodeAt(startPos, startLoc), 0, false, true) }
    if (canBeArrow && !this.canInsertSemicolon()) {
      if (this.eat(types.arrow))
        { return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], false) }
      if (this.options.ecmaVersion >= 8 && id.name === "async" && this.type === types.name && !containsEsc) {
        id = this.parseIdent(false);
        if (this.canInsertSemicolon() || !this.eat(types.arrow))
          { this.unexpected(); }
        return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), [id], true)
      }
    }
    return id

  case types.regexp:
    var value = this.value;
    node = this.parseLiteral(value.value);
    node.regex = {pattern: value.pattern, flags: value.flags};
    return node

  case types.num: case types.string:
    return this.parseLiteral(this.value)

  case types._null: case types._true: case types._false:
    node = this.startNode();
    node.value = this.type === types._null ? null : this.type === types._true;
    node.raw = this.type.keyword;
    this.next();
    return this.finishNode(node, "Literal")

  case types.parenL:
    var start = this.start, expr = this.parseParenAndDistinguishExpression(canBeArrow);
    if (refDestructuringErrors) {
      if (refDestructuringErrors.parenthesizedAssign < 0 && !this.isSimpleAssignTarget(expr))
        { refDestructuringErrors.parenthesizedAssign = start; }
      if (refDestructuringErrors.parenthesizedBind < 0)
        { refDestructuringErrors.parenthesizedBind = start; }
    }
    return expr

  case types.bracketL:
    node = this.startNode();
    this.next();
    node.elements = this.parseExprList(types.bracketR, true, true, refDestructuringErrors);
    return this.finishNode(node, "ArrayExpression")

  case types.braceL:
    return this.parseObj(false, refDestructuringErrors)

  case types._function:
    node = this.startNode();
    this.next();
    return this.parseFunction(node, 0)

  case types._class:
    return this.parseClass(this.startNode(), false)

  case types._new:
    return this.parseNew()

  case types.backQuote:
    return this.parseTemplate()

  default:
    this.unexpected();
  }
};

pp$3.parseLiteral = function(value) {
  var node = this.startNode();
  node.value = value;
  node.raw = this.input.slice(this.start, this.end);
  this.next();
  return this.finishNode(node, "Literal")
};

pp$3.parseParenExpression = function() {
  this.expect(types.parenL);
  var val = this.parseExpression();
  this.expect(types.parenR);
  return val
};

pp$3.parseParenAndDistinguishExpression = function(canBeArrow) {
  var this$1 = this;

  var startPos = this.start, startLoc = this.startLoc, val, allowTrailingComma = this.options.ecmaVersion >= 8;
  if (this.options.ecmaVersion >= 6) {
    this.next();

    var innerStartPos = this.start, innerStartLoc = this.startLoc;
    var exprList = [], first = true, lastIsComma = false;
    var refDestructuringErrors = new DestructuringErrors, oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, spreadStart;
    this.yieldPos = 0;
    this.awaitPos = 0;
    // Do not save awaitIdentPos to allow checking awaits nested in parameters
    while (this.type !== types.parenR) {
      first ? first = false : this$1.expect(types.comma);
      if (allowTrailingComma && this$1.afterTrailingComma(types.parenR, true)) {
        lastIsComma = true;
        break
      } else if (this$1.type === types.ellipsis) {
        spreadStart = this$1.start;
        exprList.push(this$1.parseParenItem(this$1.parseRestBinding()));
        if (this$1.type === types.comma) { this$1.raise(this$1.start, "Comma is not permitted after the rest element"); }
        break
      } else {
        exprList.push(this$1.parseMaybeAssign(false, refDestructuringErrors, this$1.parseParenItem));
      }
    }
    var innerEndPos = this.start, innerEndLoc = this.startLoc;
    this.expect(types.parenR);

    if (canBeArrow && !this.canInsertSemicolon() && this.eat(types.arrow)) {
      this.checkPatternErrors(refDestructuringErrors, false);
      this.checkYieldAwaitInDefaultParams();
      this.yieldPos = oldYieldPos;
      this.awaitPos = oldAwaitPos;
      return this.parseParenArrowList(startPos, startLoc, exprList)
    }

    if (!exprList.length || lastIsComma) { this.unexpected(this.lastTokStart); }
    if (spreadStart) { this.unexpected(spreadStart); }
    this.checkExpressionErrors(refDestructuringErrors, true);
    this.yieldPos = oldYieldPos || this.yieldPos;
    this.awaitPos = oldAwaitPos || this.awaitPos;

    if (exprList.length > 1) {
      val = this.startNodeAt(innerStartPos, innerStartLoc);
      val.expressions = exprList;
      this.finishNodeAt(val, "SequenceExpression", innerEndPos, innerEndLoc);
    } else {
      val = exprList[0];
    }
  } else {
    val = this.parseParenExpression();
  }

  if (this.options.preserveParens) {
    var par = this.startNodeAt(startPos, startLoc);
    par.expression = val;
    return this.finishNode(par, "ParenthesizedExpression")
  } else {
    return val
  }
};

pp$3.parseParenItem = function(item) {
  return item
};

pp$3.parseParenArrowList = function(startPos, startLoc, exprList) {
  return this.parseArrowExpression(this.startNodeAt(startPos, startLoc), exprList)
};

// New's precedence is slightly tricky. It must allow its argument to
// be a `[]` or dot subscript expression, but not a call — at least,
// not without wrapping it in parentheses. Thus, it uses the noCalls
// argument to parseSubscripts to prevent it from consuming the
// argument list.

var empty$1 = [];

pp$3.parseNew = function() {
  var node = this.startNode();
  var meta = this.parseIdent(true);
  if (this.options.ecmaVersion >= 6 && this.eat(types.dot)) {
    node.meta = meta;
    var containsEsc = this.containsEsc;
    node.property = this.parseIdent(true);
    if (node.property.name !== "target" || containsEsc)
      { this.raiseRecoverable(node.property.start, "The only valid meta property for new is new.target"); }
    if (!this.inNonArrowFunction())
      { this.raiseRecoverable(node.start, "new.target can only be used in functions"); }
    return this.finishNode(node, "MetaProperty")
  }
  var startPos = this.start, startLoc = this.startLoc;
  node.callee = this.parseSubscripts(this.parseExprAtom(), startPos, startLoc, true);
  if (this.eat(types.parenL)) { node.arguments = this.parseExprList(types.parenR, this.options.ecmaVersion >= 8, false); }
  else { node.arguments = empty$1; }
  return this.finishNode(node, "NewExpression")
};

// Parse template expression.

pp$3.parseTemplateElement = function(ref) {
  var isTagged = ref.isTagged;

  var elem = this.startNode();
  if (this.type === types.invalidTemplate) {
    if (!isTagged) {
      this.raiseRecoverable(this.start, "Bad escape sequence in untagged template literal");
    }
    elem.value = {
      raw: this.value,
      cooked: null
    };
  } else {
    elem.value = {
      raw: this.input.slice(this.start, this.end).replace(/\r\n?/g, "\n"),
      cooked: this.value
    };
  }
  this.next();
  elem.tail = this.type === types.backQuote;
  return this.finishNode(elem, "TemplateElement")
};

pp$3.parseTemplate = function(ref) {
  var this$1 = this;
  if ( ref === void 0 ) ref = {};
  var isTagged = ref.isTagged; if ( isTagged === void 0 ) isTagged = false;

  var node = this.startNode();
  this.next();
  node.expressions = [];
  var curElt = this.parseTemplateElement({isTagged: isTagged});
  node.quasis = [curElt];
  while (!curElt.tail) {
    if (this$1.type === types.eof) { this$1.raise(this$1.pos, "Unterminated template literal"); }
    this$1.expect(types.dollarBraceL);
    node.expressions.push(this$1.parseExpression());
    this$1.expect(types.braceR);
    node.quasis.push(curElt = this$1.parseTemplateElement({isTagged: isTagged}));
  }
  this.next();
  return this.finishNode(node, "TemplateLiteral")
};

pp$3.isAsyncProp = function(prop) {
  return !prop.computed && prop.key.type === "Identifier" && prop.key.name === "async" &&
    (this.type === types.name || this.type === types.num || this.type === types.string || this.type === types.bracketL || this.type.keyword || (this.options.ecmaVersion >= 9 && this.type === types.star)) &&
    !lineBreak.test(this.input.slice(this.lastTokEnd, this.start))
};

// Parse an object literal or binding pattern.

pp$3.parseObj = function(isPattern, refDestructuringErrors) {
  var this$1 = this;

  var node = this.startNode(), first = true, propHash = {};
  node.properties = [];
  this.next();
  while (!this.eat(types.braceR)) {
    if (!first) {
      this$1.expect(types.comma);
      if (this$1.afterTrailingComma(types.braceR)) { break }
    } else { first = false; }

    var prop = this$1.parseProperty(isPattern, refDestructuringErrors);
    if (!isPattern) { this$1.checkPropClash(prop, propHash, refDestructuringErrors); }
    node.properties.push(prop);
  }
  return this.finishNode(node, isPattern ? "ObjectPattern" : "ObjectExpression")
};

pp$3.parseProperty = function(isPattern, refDestructuringErrors) {
  var prop = this.startNode(), isGenerator, isAsync, startPos, startLoc;
  if (this.options.ecmaVersion >= 9 && this.eat(types.ellipsis)) {
    if (isPattern) {
      prop.argument = this.parseIdent(false);
      if (this.type === types.comma) {
        this.raise(this.start, "Comma is not permitted after the rest element");
      }
      return this.finishNode(prop, "RestElement")
    }
    // To disallow parenthesized identifier via `this.toAssignable()`.
    if (this.type === types.parenL && refDestructuringErrors) {
      if (refDestructuringErrors.parenthesizedAssign < 0) {
        refDestructuringErrors.parenthesizedAssign = this.start;
      }
      if (refDestructuringErrors.parenthesizedBind < 0) {
        refDestructuringErrors.parenthesizedBind = this.start;
      }
    }
    // Parse argument.
    prop.argument = this.parseMaybeAssign(false, refDestructuringErrors);
    // To disallow trailing comma via `this.toAssignable()`.
    if (this.type === types.comma && refDestructuringErrors && refDestructuringErrors.trailingComma < 0) {
      refDestructuringErrors.trailingComma = this.start;
    }
    // Finish
    return this.finishNode(prop, "SpreadElement")
  }
  if (this.options.ecmaVersion >= 6) {
    prop.method = false;
    prop.shorthand = false;
    if (isPattern || refDestructuringErrors) {
      startPos = this.start;
      startLoc = this.startLoc;
    }
    if (!isPattern)
      { isGenerator = this.eat(types.star); }
  }
  var containsEsc = this.containsEsc;
  this.parsePropertyName(prop);
  if (!isPattern && !containsEsc && this.options.ecmaVersion >= 8 && !isGenerator && this.isAsyncProp(prop)) {
    isAsync = true;
    isGenerator = this.options.ecmaVersion >= 9 && this.eat(types.star);
    this.parsePropertyName(prop, refDestructuringErrors);
  } else {
    isAsync = false;
  }
  this.parsePropertyValue(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc);
  return this.finishNode(prop, "Property")
};

pp$3.parsePropertyValue = function(prop, isPattern, isGenerator, isAsync, startPos, startLoc, refDestructuringErrors, containsEsc) {
  if ((isGenerator || isAsync) && this.type === types.colon)
    { this.unexpected(); }

  if (this.eat(types.colon)) {
    prop.value = isPattern ? this.parseMaybeDefault(this.start, this.startLoc) : this.parseMaybeAssign(false, refDestructuringErrors);
    prop.kind = "init";
  } else if (this.options.ecmaVersion >= 6 && this.type === types.parenL) {
    if (isPattern) { this.unexpected(); }
    prop.kind = "init";
    prop.method = true;
    prop.value = this.parseMethod(isGenerator, isAsync);
  } else if (!isPattern && !containsEsc &&
             this.options.ecmaVersion >= 5 && !prop.computed && prop.key.type === "Identifier" &&
             (prop.key.name === "get" || prop.key.name === "set") &&
             (this.type !== types.comma && this.type !== types.braceR)) {
    if (isGenerator || isAsync) { this.unexpected(); }
    prop.kind = prop.key.name;
    this.parsePropertyName(prop);
    prop.value = this.parseMethod(false);
    var paramCount = prop.kind === "get" ? 0 : 1;
    if (prop.value.params.length !== paramCount) {
      var start = prop.value.start;
      if (prop.kind === "get")
        { this.raiseRecoverable(start, "getter should have no params"); }
      else
        { this.raiseRecoverable(start, "setter should have exactly one param"); }
    } else {
      if (prop.kind === "set" && prop.value.params[0].type === "RestElement")
        { this.raiseRecoverable(prop.value.params[0].start, "Setter cannot use rest params"); }
    }
  } else if (this.options.ecmaVersion >= 6 && !prop.computed && prop.key.type === "Identifier") {
    if (isGenerator || isAsync) { this.unexpected(); }
    this.checkUnreserved(prop.key);
    if (prop.key.name === "await" && !this.awaitIdentPos)
      { this.awaitIdentPos = startPos; }
    prop.kind = "init";
    if (isPattern) {
      prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key);
    } else if (this.type === types.eq && refDestructuringErrors) {
      if (refDestructuringErrors.shorthandAssign < 0)
        { refDestructuringErrors.shorthandAssign = this.start; }
      prop.value = this.parseMaybeDefault(startPos, startLoc, prop.key);
    } else {
      prop.value = prop.key;
    }
    prop.shorthand = true;
  } else { this.unexpected(); }
};

pp$3.parsePropertyName = function(prop) {
  if (this.options.ecmaVersion >= 6) {
    if (this.eat(types.bracketL)) {
      prop.computed = true;
      prop.key = this.parseMaybeAssign();
      this.expect(types.bracketR);
      return prop.key
    } else {
      prop.computed = false;
    }
  }
  return prop.key = this.type === types.num || this.type === types.string ? this.parseExprAtom() : this.parseIdent(true)
};

// Initialize empty function node.

pp$3.initFunction = function(node) {
  node.id = null;
  if (this.options.ecmaVersion >= 6) { node.generator = node.expression = false; }
  if (this.options.ecmaVersion >= 8) { node.async = false; }
};

// Parse object or class method.

pp$3.parseMethod = function(isGenerator, isAsync, allowDirectSuper) {
  var node = this.startNode(), oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;

  this.initFunction(node);
  if (this.options.ecmaVersion >= 6)
    { node.generator = isGenerator; }
  if (this.options.ecmaVersion >= 8)
    { node.async = !!isAsync; }

  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;
  this.enterScope(functionFlags(isAsync, node.generator) | SCOPE_SUPER | (allowDirectSuper ? SCOPE_DIRECT_SUPER : 0));

  this.expect(types.parenL);
  node.params = this.parseBindingList(types.parenR, false, this.options.ecmaVersion >= 8);
  this.checkYieldAwaitInDefaultParams();
  this.parseFunctionBody(node, false, true);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "FunctionExpression")
};

// Parse arrow function expression with given parameters.

pp$3.parseArrowExpression = function(node, params, isAsync) {
  var oldYieldPos = this.yieldPos, oldAwaitPos = this.awaitPos, oldAwaitIdentPos = this.awaitIdentPos;

  this.enterScope(functionFlags(isAsync, false) | SCOPE_ARROW);
  this.initFunction(node);
  if (this.options.ecmaVersion >= 8) { node.async = !!isAsync; }

  this.yieldPos = 0;
  this.awaitPos = 0;
  this.awaitIdentPos = 0;

  node.params = this.toAssignableList(params, true);
  this.parseFunctionBody(node, true, false);

  this.yieldPos = oldYieldPos;
  this.awaitPos = oldAwaitPos;
  this.awaitIdentPos = oldAwaitIdentPos;
  return this.finishNode(node, "ArrowFunctionExpression")
};

// Parse function body and check parameters.

pp$3.parseFunctionBody = function(node, isArrowFunction, isMethod) {
  var isExpression = isArrowFunction && this.type !== types.braceL;
  var oldStrict = this.strict, useStrict = false;

  if (isExpression) {
    node.body = this.parseMaybeAssign();
    node.expression = true;
    this.checkParams(node, false);
  } else {
    var nonSimple = this.options.ecmaVersion >= 7 && !this.isSimpleParamList(node.params);
    if (!oldStrict || nonSimple) {
      useStrict = this.strictDirective(this.end);
      // If this is a strict mode function, verify that argument names
      // are not repeated, and it does not try to bind the words `eval`
      // or `arguments`.
      if (useStrict && nonSimple)
        { this.raiseRecoverable(node.start, "Illegal 'use strict' directive in function with non-simple parameter list"); }
    }
    // Start a new scope with regard to labels and the `inFunction`
    // flag (restore them to their old value afterwards).
    var oldLabels = this.labels;
    this.labels = [];
    if (useStrict) { this.strict = true; }

    // Add the params to varDeclaredNames to ensure that an error is thrown
    // if a let/const declaration in the function clashes with one of the params.
    this.checkParams(node, !oldStrict && !useStrict && !isArrowFunction && !isMethod && this.isSimpleParamList(node.params));
    node.body = this.parseBlock(false);
    node.expression = false;
    this.adaptDirectivePrologue(node.body.body);
    this.labels = oldLabels;
  }
  this.exitScope();

  // Ensure the function name isn't a forbidden identifier in strict mode, e.g. 'eval'
  if (this.strict && node.id) { this.checkLVal(node.id, BIND_OUTSIDE); }
  this.strict = oldStrict;
};

pp$3.isSimpleParamList = function(params) {
  for (var i = 0, list = params; i < list.length; i += 1)
    {
    var param = list[i];

    if (param.type !== "Identifier") { return false
  } }
  return true
};

// Checks function params for various disallowed patterns such as using "eval"
// or "arguments" and duplicate parameters.

pp$3.checkParams = function(node, allowDuplicates) {
  var this$1 = this;

  var nameHash = {};
  for (var i = 0, list = node.params; i < list.length; i += 1)
    {
    var param = list[i];

    this$1.checkLVal(param, BIND_VAR, allowDuplicates ? null : nameHash);
  }
};

// Parses a comma-separated list of expressions, and returns them as
// an array. `close` is the token type that ends the list, and
// `allowEmpty` can be turned on to allow subsequent commas with
// nothing in between them to be parsed as `null` (which is needed
// for array literals).

pp$3.parseExprList = function(close, allowTrailingComma, allowEmpty, refDestructuringErrors) {
  var this$1 = this;

  var elts = [], first = true;
  while (!this.eat(close)) {
    if (!first) {
      this$1.expect(types.comma);
      if (allowTrailingComma && this$1.afterTrailingComma(close)) { break }
    } else { first = false; }

    var elt = (void 0);
    if (allowEmpty && this$1.type === types.comma)
      { elt = null; }
    else if (this$1.type === types.ellipsis) {
      elt = this$1.parseSpread(refDestructuringErrors);
      if (refDestructuringErrors && this$1.type === types.comma && refDestructuringErrors.trailingComma < 0)
        { refDestructuringErrors.trailingComma = this$1.start; }
    } else {
      elt = this$1.parseMaybeAssign(false, refDestructuringErrors);
    }
    elts.push(elt);
  }
  return elts
};

pp$3.checkUnreserved = function(ref) {
  var start = ref.start;
  var end = ref.end;
  var name = ref.name;

  if (this.inGenerator && name === "yield")
    { this.raiseRecoverable(start, "Cannot use 'yield' as identifier inside a generator"); }
  if (this.inAsync && name === "await")
    { this.raiseRecoverable(start, "Cannot use 'await' as identifier inside an async function"); }
  if (this.keywords.test(name))
    { this.raise(start, ("Unexpected keyword '" + name + "'")); }
  if (this.options.ecmaVersion < 6 &&
    this.input.slice(start, end).indexOf("\\") !== -1) { return }
  var re = this.strict ? this.reservedWordsStrict : this.reservedWords;
  if (re.test(name)) {
    if (!this.inAsync && name === "await")
      { this.raiseRecoverable(start, "Cannot use keyword 'await' outside an async function"); }
    this.raiseRecoverable(start, ("The keyword '" + name + "' is reserved"));
  }
};

// Parse the next token as an identifier. If `liberal` is true (used
// when parsing properties), it will also convert keywords into
// identifiers.

pp$3.parseIdent = function(liberal, isBinding) {
  var node = this.startNode();
  if (liberal && this.options.allowReserved === "never") { liberal = false; }
  if (this.type === types.name) {
    node.name = this.value;
  } else if (this.type.keyword) {
    node.name = this.type.keyword;

    // To fix https://github.com/acornjs/acorn/issues/575
    // `class` and `function` keywords push new context into this.context.
    // But there is no chance to pop the context if the keyword is consumed as an identifier such as a property name.
    // If the previous token is a dot, this does not apply because the context-managing code already ignored the keyword
    if ((node.name === "class" || node.name === "function") &&
        (this.lastTokEnd !== this.lastTokStart + 1 || this.input.charCodeAt(this.lastTokStart) !== 46)) {
      this.context.pop();
    }
  } else {
    this.unexpected();
  }
  this.next();
  this.finishNode(node, "Identifier");
  if (!liberal) {
    this.checkUnreserved(node);
    if (node.name === "await" && !this.awaitIdentPos)
      { this.awaitIdentPos = node.start; }
  }
  return node
};

// Parses yield expression inside generator.

pp$3.parseYield = function(noIn) {
  if (!this.yieldPos) { this.yieldPos = this.start; }

  var node = this.startNode();
  this.next();
  if (this.type === types.semi || this.canInsertSemicolon() || (this.type !== types.star && !this.type.startsExpr)) {
    node.delegate = false;
    node.argument = null;
  } else {
    node.delegate = this.eat(types.star);
    node.argument = this.parseMaybeAssign(noIn);
  }
  return this.finishNode(node, "YieldExpression")
};

pp$3.parseAwait = function() {
  if (!this.awaitPos) { this.awaitPos = this.start; }

  var node = this.startNode();
  this.next();
  node.argument = this.parseMaybeUnary(null, true);
  return this.finishNode(node, "AwaitExpression")
};

var pp$4 = Parser.prototype;

// This function is used to raise exceptions on parse errors. It
// takes an offset integer (into the current `input`) to indicate
// the location of the error, attaches the position to the end
// of the error message, and then raises a `SyntaxError` with that
// message.

pp$4.raise = function(pos, message) {
  var loc = getLineInfo(this.input, pos);
  message += " (" + loc.line + ":" + loc.column + ")";
  var err = new SyntaxError(message);
  err.pos = pos; err.loc = loc; err.raisedAt = this.pos;
  throw err
};

pp$4.raiseRecoverable = pp$4.raise;

pp$4.curPosition = function() {
  if (this.options.locations) {
    return new Position(this.curLine, this.pos - this.lineStart)
  }
};

var pp$5 = Parser.prototype;

var Scope = function Scope(flags) {
  this.flags = flags;
  // A list of var-declared names in the current lexical scope
  this.var = [];
  // A list of lexically-declared names in the current lexical scope
  this.lexical = [];
  // A list of lexically-declared FunctionDeclaration names in the current lexical scope
  this.functions = [];
};

// The functions in this module keep track of declared variables in the current scope in order to detect duplicate variable names.

pp$5.enterScope = function(flags) {
  this.scopeStack.push(new Scope(flags));
};

pp$5.exitScope = function() {
  this.scopeStack.pop();
};

// The spec says:
// > At the top level of a function, or script, function declarations are
// > treated like var declarations rather than like lexical declarations.
pp$5.treatFunctionsAsVarInScope = function(scope) {
  return (scope.flags & SCOPE_FUNCTION) || !this.inModule && (scope.flags & SCOPE_TOP)
};

pp$5.declareName = function(name, bindingType, pos) {
  var this$1 = this;

  var redeclared = false;
  if (bindingType === BIND_LEXICAL) {
    var scope = this.currentScope();
    redeclared = scope.lexical.indexOf(name) > -1 || scope.functions.indexOf(name) > -1 || scope.var.indexOf(name) > -1;
    scope.lexical.push(name);
    if (this.inModule && (scope.flags & SCOPE_TOP))
      { delete this.undefinedExports[name]; }
  } else if (bindingType === BIND_SIMPLE_CATCH) {
    var scope$1 = this.currentScope();
    scope$1.lexical.push(name);
  } else if (bindingType === BIND_FUNCTION) {
    var scope$2 = this.currentScope();
    if (this.treatFunctionsAsVar)
      { redeclared = scope$2.lexical.indexOf(name) > -1; }
    else
      { redeclared = scope$2.lexical.indexOf(name) > -1 || scope$2.var.indexOf(name) > -1; }
    scope$2.functions.push(name);
  } else {
    for (var i = this.scopeStack.length - 1; i >= 0; --i) {
      var scope$3 = this$1.scopeStack[i];
      if (scope$3.lexical.indexOf(name) > -1 && !((scope$3.flags & SCOPE_SIMPLE_CATCH) && scope$3.lexical[0] === name) ||
          !this$1.treatFunctionsAsVarInScope(scope$3) && scope$3.functions.indexOf(name) > -1) {
        redeclared = true;
        break
      }
      scope$3.var.push(name);
      if (this$1.inModule && (scope$3.flags & SCOPE_TOP))
        { delete this$1.undefinedExports[name]; }
      if (scope$3.flags & SCOPE_VAR) { break }
    }
  }
  if (redeclared) { this.raiseRecoverable(pos, ("Identifier '" + name + "' has already been declared")); }
};

pp$5.checkLocalExport = function(id) {
  // scope.functions must be empty as Module code is always strict.
  if (this.scopeStack[0].lexical.indexOf(id.name) === -1 &&
      this.scopeStack[0].var.indexOf(id.name) === -1) {
    this.undefinedExports[id.name] = id;
  }
};

pp$5.currentScope = function() {
  return this.scopeStack[this.scopeStack.length - 1]
};

pp$5.currentVarScope = function() {
  var this$1 = this;

  for (var i = this.scopeStack.length - 1;; i--) {
    var scope = this$1.scopeStack[i];
    if (scope.flags & SCOPE_VAR) { return scope }
  }
};

// Could be useful for `this`, `new.target`, `super()`, `super.property`, and `super[property]`.
pp$5.currentThisScope = function() {
  var this$1 = this;

  for (var i = this.scopeStack.length - 1;; i--) {
    var scope = this$1.scopeStack[i];
    if (scope.flags & SCOPE_VAR && !(scope.flags & SCOPE_ARROW)) { return scope }
  }
};

var Node = function Node(parser, pos, loc) {
  this.type = "";
  this.start = pos;
  this.end = 0;
  if (parser.options.locations)
    { this.loc = new SourceLocation(parser, loc); }
  if (parser.options.directSourceFile)
    { this.sourceFile = parser.options.directSourceFile; }
  if (parser.options.ranges)
    { this.range = [pos, 0]; }
};

// Start an AST node, attaching a start offset.

var pp$6 = Parser.prototype;

pp$6.startNode = function() {
  return new Node(this, this.start, this.startLoc)
};

pp$6.startNodeAt = function(pos, loc) {
  return new Node(this, pos, loc)
};

// Finish an AST node, adding `type` and `end` properties.

function finishNodeAt(node, type, pos, loc) {
  node.type = type;
  node.end = pos;
  if (this.options.locations)
    { node.loc.end = loc; }
  if (this.options.ranges)
    { node.range[1] = pos; }
  return node
}

pp$6.finishNode = function(node, type) {
  return finishNodeAt.call(this, node, type, this.lastTokEnd, this.lastTokEndLoc)
};

// Finish node at given position

pp$6.finishNodeAt = function(node, type, pos, loc) {
  return finishNodeAt.call(this, node, type, pos, loc)
};

// The algorithm used to determine whether a regexp can appear at a
// given point in the program is loosely based on sweet.js' approach.
// See https://github.com/mozilla/sweet.js/wiki/design

var TokContext = function TokContext(token, isExpr, preserveSpace, override, generator) {
  this.token = token;
  this.isExpr = !!isExpr;
  this.preserveSpace = !!preserveSpace;
  this.override = override;
  this.generator = !!generator;
};

var types$1 = {
  b_stat: new TokContext("{", false),
  b_expr: new TokContext("{", true),
  b_tmpl: new TokContext("${", false),
  p_stat: new TokContext("(", false),
  p_expr: new TokContext("(", true),
  q_tmpl: new TokContext("`", true, true, function (p) { return p.tryReadTemplateToken(); }),
  f_stat: new TokContext("function", false),
  f_expr: new TokContext("function", true),
  f_expr_gen: new TokContext("function", true, false, null, true),
  f_gen: new TokContext("function", false, false, null, true)
};

var pp$7 = Parser.prototype;

pp$7.initialContext = function() {
  return [types$1.b_stat]
};

pp$7.braceIsBlock = function(prevType) {
  var parent = this.curContext();
  if (parent === types$1.f_expr || parent === types$1.f_stat)
    { return true }
  if (prevType === types.colon && (parent === types$1.b_stat || parent === types$1.b_expr))
    { return !parent.isExpr }

  // The check for `tt.name && exprAllowed` detects whether we are
  // after a `yield` or `of` construct. See the `updateContext` for
  // `tt.name`.
  if (prevType === types._return || prevType === types.name && this.exprAllowed)
    { return lineBreak.test(this.input.slice(this.lastTokEnd, this.start)) }
  if (prevType === types._else || prevType === types.semi || prevType === types.eof || prevType === types.parenR || prevType === types.arrow)
    { return true }
  if (prevType === types.braceL)
    { return parent === types$1.b_stat }
  if (prevType === types._var || prevType === types._const || prevType === types.name)
    { return false }
  return !this.exprAllowed
};

pp$7.inGeneratorContext = function() {
  var this$1 = this;

  for (var i = this.context.length - 1; i >= 1; i--) {
    var context = this$1.context[i];
    if (context.token === "function")
      { return context.generator }
  }
  return false
};

pp$7.updateContext = function(prevType) {
  var update, type = this.type;
  if (type.keyword && prevType === types.dot)
    { this.exprAllowed = false; }
  else if (update = type.updateContext)
    { update.call(this, prevType); }
  else
    { this.exprAllowed = type.beforeExpr; }
};

// Token-specific context update code

types.parenR.updateContext = types.braceR.updateContext = function() {
  if (this.context.length === 1) {
    this.exprAllowed = true;
    return
  }
  var out = this.context.pop();
  if (out === types$1.b_stat && this.curContext().token === "function") {
    out = this.context.pop();
  }
  this.exprAllowed = !out.isExpr;
};

types.braceL.updateContext = function(prevType) {
  this.context.push(this.braceIsBlock(prevType) ? types$1.b_stat : types$1.b_expr);
  this.exprAllowed = true;
};

types.dollarBraceL.updateContext = function() {
  this.context.push(types$1.b_tmpl);
  this.exprAllowed = true;
};

types.parenL.updateContext = function(prevType) {
  var statementParens = prevType === types._if || prevType === types._for || prevType === types._with || prevType === types._while;
  this.context.push(statementParens ? types$1.p_stat : types$1.p_expr);
  this.exprAllowed = true;
};

types.incDec.updateContext = function() {
  // tokExprAllowed stays unchanged
};

types._function.updateContext = types._class.updateContext = function(prevType) {
  if (prevType.beforeExpr && prevType !== types.semi && prevType !== types._else &&
      !(prevType === types._return && lineBreak.test(this.input.slice(this.lastTokEnd, this.start))) &&
      !((prevType === types.colon || prevType === types.braceL) && this.curContext() === types$1.b_stat))
    { this.context.push(types$1.f_expr); }
  else
    { this.context.push(types$1.f_stat); }
  this.exprAllowed = false;
};

types.backQuote.updateContext = function() {
  if (this.curContext() === types$1.q_tmpl)
    { this.context.pop(); }
  else
    { this.context.push(types$1.q_tmpl); }
  this.exprAllowed = false;
};

types.star.updateContext = function(prevType) {
  if (prevType === types._function) {
    var index = this.context.length - 1;
    if (this.context[index] === types$1.f_expr)
      { this.context[index] = types$1.f_expr_gen; }
    else
      { this.context[index] = types$1.f_gen; }
  }
  this.exprAllowed = true;
};

types.name.updateContext = function(prevType) {
  var allowed = false;
  if (this.options.ecmaVersion >= 6 && prevType !== types.dot) {
    if (this.value === "of" && !this.exprAllowed ||
        this.value === "yield" && this.inGeneratorContext())
      { allowed = true; }
  }
  this.exprAllowed = allowed;
};

// This file contains Unicode properties extracted from the ECMAScript
// specification. The lists are extracted like so:
// $$('#table-binary-unicode-properties > figure > table > tbody > tr > td:nth-child(1) code').map(el => el.innerText)

// #table-binary-unicode-properties
var ecma9BinaryProperties = "ASCII ASCII_Hex_Digit AHex Alphabetic Alpha Any Assigned Bidi_Control Bidi_C Bidi_Mirrored Bidi_M Case_Ignorable CI Cased Changes_When_Casefolded CWCF Changes_When_Casemapped CWCM Changes_When_Lowercased CWL Changes_When_NFKC_Casefolded CWKCF Changes_When_Titlecased CWT Changes_When_Uppercased CWU Dash Default_Ignorable_Code_Point DI Deprecated Dep Diacritic Dia Emoji Emoji_Component Emoji_Modifier Emoji_Modifier_Base Emoji_Presentation Extender Ext Grapheme_Base Gr_Base Grapheme_Extend Gr_Ext Hex_Digit Hex IDS_Binary_Operator IDSB IDS_Trinary_Operator IDST ID_Continue IDC ID_Start IDS Ideographic Ideo Join_Control Join_C Logical_Order_Exception LOE Lowercase Lower Math Noncharacter_Code_Point NChar Pattern_Syntax Pat_Syn Pattern_White_Space Pat_WS Quotation_Mark QMark Radical Regional_Indicator RI Sentence_Terminal STerm Soft_Dotted SD Terminal_Punctuation Term Unified_Ideograph UIdeo Uppercase Upper Variation_Selector VS White_Space space XID_Continue XIDC XID_Start XIDS";
var unicodeBinaryProperties = {
  9: ecma9BinaryProperties,
  10: ecma9BinaryProperties + " Extended_Pictographic"
};

// #table-unicode-general-category-values
var unicodeGeneralCategoryValues = "Cased_Letter LC Close_Punctuation Pe Connector_Punctuation Pc Control Cc cntrl Currency_Symbol Sc Dash_Punctuation Pd Decimal_Number Nd digit Enclosing_Mark Me Final_Punctuation Pf Format Cf Initial_Punctuation Pi Letter L Letter_Number Nl Line_Separator Zl Lowercase_Letter Ll Mark M Combining_Mark Math_Symbol Sm Modifier_Letter Lm Modifier_Symbol Sk Nonspacing_Mark Mn Number N Open_Punctuation Ps Other C Other_Letter Lo Other_Number No Other_Punctuation Po Other_Symbol So Paragraph_Separator Zp Private_Use Co Punctuation P punct Separator Z Space_Separator Zs Spacing_Mark Mc Surrogate Cs Symbol S Titlecase_Letter Lt Unassigned Cn Uppercase_Letter Lu";

// #table-unicode-script-values
var ecma9ScriptValues = "Adlam Adlm Ahom Ahom Anatolian_Hieroglyphs Hluw Arabic Arab Armenian Armn Avestan Avst Balinese Bali Bamum Bamu Bassa_Vah Bass Batak Batk Bengali Beng Bhaiksuki Bhks Bopomofo Bopo Brahmi Brah Braille Brai Buginese Bugi Buhid Buhd Canadian_Aboriginal Cans Carian Cari Caucasian_Albanian Aghb Chakma Cakm Cham Cham Cherokee Cher Common Zyyy Coptic Copt Qaac Cuneiform Xsux Cypriot Cprt Cyrillic Cyrl Deseret Dsrt Devanagari Deva Duployan Dupl Egyptian_Hieroglyphs Egyp Elbasan Elba Ethiopic Ethi Georgian Geor Glagolitic Glag Gothic Goth Grantha Gran Greek Grek Gujarati Gujr Gurmukhi Guru Han Hani Hangul Hang Hanunoo Hano Hatran Hatr Hebrew Hebr Hiragana Hira Imperial_Aramaic Armi Inherited Zinh Qaai Inscriptional_Pahlavi Phli Inscriptional_Parthian Prti Javanese Java Kaithi Kthi Kannada Knda Katakana Kana Kayah_Li Kali Kharoshthi Khar Khmer Khmr Khojki Khoj Khudawadi Sind Lao Laoo Latin Latn Lepcha Lepc Limbu Limb Linear_A Lina Linear_B Linb Lisu Lisu Lycian Lyci Lydian Lydi Mahajani Mahj Malayalam Mlym Mandaic Mand Manichaean Mani Marchen Marc Masaram_Gondi Gonm Meetei_Mayek Mtei Mende_Kikakui Mend Meroitic_Cursive Merc Meroitic_Hieroglyphs Mero Miao Plrd Modi Modi Mongolian Mong Mro Mroo Multani Mult Myanmar Mymr Nabataean Nbat New_Tai_Lue Talu Newa Newa Nko Nkoo Nushu Nshu Ogham Ogam Ol_Chiki Olck Old_Hungarian Hung Old_Italic Ital Old_North_Arabian Narb Old_Permic Perm Old_Persian Xpeo Old_South_Arabian Sarb Old_Turkic Orkh Oriya Orya Osage Osge Osmanya Osma Pahawh_Hmong Hmng Palmyrene Palm Pau_Cin_Hau Pauc Phags_Pa Phag Phoenician Phnx Psalter_Pahlavi Phlp Rejang Rjng Runic Runr Samaritan Samr Saurashtra Saur Sharada Shrd Shavian Shaw Siddham Sidd SignWriting Sgnw Sinhala Sinh Sora_Sompeng Sora Soyombo Soyo Sundanese Sund Syloti_Nagri Sylo Syriac Syrc Tagalog Tglg Tagbanwa Tagb Tai_Le Tale Tai_Tham Lana Tai_Viet Tavt Takri Takr Tamil Taml Tangut Tang Telugu Telu Thaana Thaa Thai Thai Tibetan Tibt Tifinagh Tfng Tirhuta Tirh Ugaritic Ugar Vai Vaii Warang_Citi Wara Yi Yiii Zanabazar_Square Zanb";
var unicodeScriptValues = {
  9: ecma9ScriptValues,
  10: ecma9ScriptValues + " Dogra Dogr Gunjala_Gondi Gong Hanifi_Rohingya Rohg Makasar Maka Medefaidrin Medf Old_Sogdian Sogo Sogdian Sogd"
};

var data = {};
function buildUnicodeData(ecmaVersion) {
  var d = data[ecmaVersion] = {
    binary: wordsRegexp(unicodeBinaryProperties[ecmaVersion] + " " + unicodeGeneralCategoryValues),
    nonBinary: {
      General_Category: wordsRegexp(unicodeGeneralCategoryValues),
      Script: wordsRegexp(unicodeScriptValues[ecmaVersion])
    }
  };
  d.nonBinary.Script_Extensions = d.nonBinary.Script;

  d.nonBinary.gc = d.nonBinary.General_Category;
  d.nonBinary.sc = d.nonBinary.Script;
  d.nonBinary.scx = d.nonBinary.Script_Extensions;
}
buildUnicodeData(9);
buildUnicodeData(10);

var pp$9 = Parser.prototype;

var RegExpValidationState = function RegExpValidationState(parser) {
  this.parser = parser;
  this.validFlags = "gim" + (parser.options.ecmaVersion >= 6 ? "uy" : "") + (parser.options.ecmaVersion >= 9 ? "s" : "");
  this.unicodeProperties = data[parser.options.ecmaVersion >= 10 ? 10 : parser.options.ecmaVersion];
  this.source = "";
  this.flags = "";
  this.start = 0;
  this.switchU = false;
  this.switchN = false;
  this.pos = 0;
  this.lastIntValue = 0;
  this.lastStringValue = "";
  this.lastAssertionIsQuantifiable = false;
  this.numCapturingParens = 0;
  this.maxBackReference = 0;
  this.groupNames = [];
  this.backReferenceNames = [];
};

RegExpValidationState.prototype.reset = function reset (start, pattern, flags) {
  var unicode = flags.indexOf("u") !== -1;
  this.start = start | 0;
  this.source = pattern + "";
  this.flags = flags;
  this.switchU = unicode && this.parser.options.ecmaVersion >= 6;
  this.switchN = unicode && this.parser.options.ecmaVersion >= 9;
};

RegExpValidationState.prototype.raise = function raise (message) {
  this.parser.raiseRecoverable(this.start, ("Invalid regular expression: /" + (this.source) + "/: " + message));
};

// If u flag is given, this returns the code point at the index (it combines a surrogate pair).
// Otherwise, this returns the code unit of the index (can be a part of a surrogate pair).
RegExpValidationState.prototype.at = function at (i) {
  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return -1
  }
  var c = s.charCodeAt(i);
  if (!this.switchU || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l) {
    return c
  }
  return (c << 10) + s.charCodeAt(i + 1) - 0x35FDC00
};

RegExpValidationState.prototype.nextIndex = function nextIndex (i) {
  var s = this.source;
  var l = s.length;
  if (i >= l) {
    return l
  }
  var c = s.charCodeAt(i);
  if (!this.switchU || c <= 0xD7FF || c >= 0xE000 || i + 1 >= l) {
    return i + 1
  }
  return i + 2
};

RegExpValidationState.prototype.current = function current () {
  return this.at(this.pos)
};

RegExpValidationState.prototype.lookahead = function lookahead () {
  return this.at(this.nextIndex(this.pos))
};

RegExpValidationState.prototype.advance = function advance () {
  this.pos = this.nextIndex(this.pos);
};

RegExpValidationState.prototype.eat = function eat (ch) {
  if (this.current() === ch) {
    this.advance();
    return true
  }
  return false
};

function codePointToString$1(ch) {
  if (ch <= 0xFFFF) { return String.fromCharCode(ch) }
  ch -= 0x10000;
  return String.fromCharCode((ch >> 10) + 0xD800, (ch & 0x03FF) + 0xDC00)
}

/**
 * Validate the flags part of a given RegExpLiteral.
 *
 * @param {RegExpValidationState} state The state to validate RegExp.
 * @returns {void}
 */
pp$9.validateRegExpFlags = function(state) {
  var this$1 = this;

  var validFlags = state.validFlags;
  var flags = state.flags;

  for (var i = 0; i < flags.length; i++) {
    var flag = flags.charAt(i);
    if (validFlags.indexOf(flag) === -1) {
      this$1.raise(state.start, "Invalid regular expression flag");
    }
    if (flags.indexOf(flag, i + 1) > -1) {
      this$1.raise(state.start, "Duplicate regular expression flag");
    }
  }
};

/**
 * Validate the pattern part of a given RegExpLiteral.
 *
 * @param {RegExpValidationState} state The state to validate RegExp.
 * @returns {void}
 */
pp$9.validateRegExpPattern = function(state) {
  this.regexp_pattern(state);

  // The goal symbol for the parse is |Pattern[~U, ~N]|. If the result of
  // parsing contains a |GroupName|, reparse with the goal symbol
  // |Pattern[~U, +N]| and use this result instead. Throw a *SyntaxError*
  // exception if _P_ did not conform to the grammar, if any elements of _P_
  // were not matched by the parse, or if any Early Error conditions exist.
  if (!state.switchN && this.options.ecmaVersion >= 9 && state.groupNames.length > 0) {
    state.switchN = true;
    this.regexp_pattern(state);
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Pattern
pp$9.regexp_pattern = function(state) {
  state.pos = 0;
  state.lastIntValue = 0;
  state.lastStringValue = "";
  state.lastAssertionIsQuantifiable = false;
  state.numCapturingParens = 0;
  state.maxBackReference = 0;
  state.groupNames.length = 0;
  state.backReferenceNames.length = 0;

  this.regexp_disjunction(state);

  if (state.pos !== state.source.length) {
    // Make the same messages as V8.
    if (state.eat(0x29 /* ) */)) {
      state.raise("Unmatched ')'");
    }
    if (state.eat(0x5D /* [ */) || state.eat(0x7D /* } */)) {
      state.raise("Lone quantifier brackets");
    }
  }
  if (state.maxBackReference > state.numCapturingParens) {
    state.raise("Invalid escape");
  }
  for (var i = 0, list = state.backReferenceNames; i < list.length; i += 1) {
    var name = list[i];

    if (state.groupNames.indexOf(name) === -1) {
      state.raise("Invalid named capture referenced");
    }
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Disjunction
pp$9.regexp_disjunction = function(state) {
  var this$1 = this;

  this.regexp_alternative(state);
  while (state.eat(0x7C /* | */)) {
    this$1.regexp_alternative(state);
  }

  // Make the same message as V8.
  if (this.regexp_eatQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  if (state.eat(0x7B /* { */)) {
    state.raise("Lone quantifier brackets");
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Alternative
pp$9.regexp_alternative = function(state) {
  while (state.pos < state.source.length && this.regexp_eatTerm(state))
    {  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Term
pp$9.regexp_eatTerm = function(state) {
  if (this.regexp_eatAssertion(state)) {
    // Handle `QuantifiableAssertion Quantifier` alternative.
    // `state.lastAssertionIsQuantifiable` is true if the last eaten Assertion
    // is a QuantifiableAssertion.
    if (state.lastAssertionIsQuantifiable && this.regexp_eatQuantifier(state)) {
      // Make the same message as V8.
      if (state.switchU) {
        state.raise("Invalid quantifier");
      }
    }
    return true
  }

  if (state.switchU ? this.regexp_eatAtom(state) : this.regexp_eatExtendedAtom(state)) {
    this.regexp_eatQuantifier(state);
    return true
  }

  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-Assertion
pp$9.regexp_eatAssertion = function(state) {
  var start = state.pos;
  state.lastAssertionIsQuantifiable = false;

  // ^, $
  if (state.eat(0x5E /* ^ */) || state.eat(0x24 /* $ */)) {
    return true
  }

  // \b \B
  if (state.eat(0x5C /* \ */)) {
    if (state.eat(0x42 /* B */) || state.eat(0x62 /* b */)) {
      return true
    }
    state.pos = start;
  }

  // Lookahead / Lookbehind
  if (state.eat(0x28 /* ( */) && state.eat(0x3F /* ? */)) {
    var lookbehind = false;
    if (this.options.ecmaVersion >= 9) {
      lookbehind = state.eat(0x3C /* < */);
    }
    if (state.eat(0x3D /* = */) || state.eat(0x21 /* ! */)) {
      this.regexp_disjunction(state);
      if (!state.eat(0x29 /* ) */)) {
        state.raise("Unterminated group");
      }
      state.lastAssertionIsQuantifiable = !lookbehind;
      return true
    }
  }

  state.pos = start;
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Quantifier
pp$9.regexp_eatQuantifier = function(state, noError) {
  if ( noError === void 0 ) noError = false;

  if (this.regexp_eatQuantifierPrefix(state, noError)) {
    state.eat(0x3F /* ? */);
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-QuantifierPrefix
pp$9.regexp_eatQuantifierPrefix = function(state, noError) {
  return (
    state.eat(0x2A /* * */) ||
    state.eat(0x2B /* + */) ||
    state.eat(0x3F /* ? */) ||
    this.regexp_eatBracedQuantifier(state, noError)
  )
};
pp$9.regexp_eatBracedQuantifier = function(state, noError) {
  var start = state.pos;
  if (state.eat(0x7B /* { */)) {
    var min = 0, max = -1;
    if (this.regexp_eatDecimalDigits(state)) {
      min = state.lastIntValue;
      if (state.eat(0x2C /* , */) && this.regexp_eatDecimalDigits(state)) {
        max = state.lastIntValue;
      }
      if (state.eat(0x7D /* } */)) {
        // SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-term
        if (max !== -1 && max < min && !noError) {
          state.raise("numbers out of order in {} quantifier");
        }
        return true
      }
    }
    if (state.switchU && !noError) {
      state.raise("Incomplete quantifier");
    }
    state.pos = start;
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-Atom
pp$9.regexp_eatAtom = function(state) {
  return (
    this.regexp_eatPatternCharacters(state) ||
    state.eat(0x2E /* . */) ||
    this.regexp_eatReverseSolidusAtomEscape(state) ||
    this.regexp_eatCharacterClass(state) ||
    this.regexp_eatUncapturingGroup(state) ||
    this.regexp_eatCapturingGroup(state)
  )
};
pp$9.regexp_eatReverseSolidusAtomEscape = function(state) {
  var start = state.pos;
  if (state.eat(0x5C /* \ */)) {
    if (this.regexp_eatAtomEscape(state)) {
      return true
    }
    state.pos = start;
  }
  return false
};
pp$9.regexp_eatUncapturingGroup = function(state) {
  var start = state.pos;
  if (state.eat(0x28 /* ( */)) {
    if (state.eat(0x3F /* ? */) && state.eat(0x3A /* : */)) {
      this.regexp_disjunction(state);
      if (state.eat(0x29 /* ) */)) {
        return true
      }
      state.raise("Unterminated group");
    }
    state.pos = start;
  }
  return false
};
pp$9.regexp_eatCapturingGroup = function(state) {
  if (state.eat(0x28 /* ( */)) {
    if (this.options.ecmaVersion >= 9) {
      this.regexp_groupSpecifier(state);
    } else if (state.current() === 0x3F /* ? */) {
      state.raise("Invalid group");
    }
    this.regexp_disjunction(state);
    if (state.eat(0x29 /* ) */)) {
      state.numCapturingParens += 1;
      return true
    }
    state.raise("Unterminated group");
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedAtom
pp$9.regexp_eatExtendedAtom = function(state) {
  return (
    state.eat(0x2E /* . */) ||
    this.regexp_eatReverseSolidusAtomEscape(state) ||
    this.regexp_eatCharacterClass(state) ||
    this.regexp_eatUncapturingGroup(state) ||
    this.regexp_eatCapturingGroup(state) ||
    this.regexp_eatInvalidBracedQuantifier(state) ||
    this.regexp_eatExtendedPatternCharacter(state)
  )
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-InvalidBracedQuantifier
pp$9.regexp_eatInvalidBracedQuantifier = function(state) {
  if (this.regexp_eatBracedQuantifier(state, true)) {
    state.raise("Nothing to repeat");
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-SyntaxCharacter
pp$9.regexp_eatSyntaxCharacter = function(state) {
  var ch = state.current();
  if (isSyntaxCharacter(ch)) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }
  return false
};
function isSyntaxCharacter(ch) {
  return (
    ch === 0x24 /* $ */ ||
    ch >= 0x28 /* ( */ && ch <= 0x2B /* + */ ||
    ch === 0x2E /* . */ ||
    ch === 0x3F /* ? */ ||
    ch >= 0x5B /* [ */ && ch <= 0x5E /* ^ */ ||
    ch >= 0x7B /* { */ && ch <= 0x7D /* } */
  )
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-PatternCharacter
// But eat eager.
pp$9.regexp_eatPatternCharacters = function(state) {
  var start = state.pos;
  var ch = 0;
  while ((ch = state.current()) !== -1 && !isSyntaxCharacter(ch)) {
    state.advance();
  }
  return state.pos !== start
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ExtendedPatternCharacter
pp$9.regexp_eatExtendedPatternCharacter = function(state) {
  var ch = state.current();
  if (
    ch !== -1 &&
    ch !== 0x24 /* $ */ &&
    !(ch >= 0x28 /* ( */ && ch <= 0x2B /* + */) &&
    ch !== 0x2E /* . */ &&
    ch !== 0x3F /* ? */ &&
    ch !== 0x5B /* [ */ &&
    ch !== 0x5E /* ^ */ &&
    ch !== 0x7C /* | */
  ) {
    state.advance();
    return true
  }
  return false
};

// GroupSpecifier[U] ::
//   [empty]
//   `?` GroupName[?U]
pp$9.regexp_groupSpecifier = function(state) {
  if (state.eat(0x3F /* ? */)) {
    if (this.regexp_eatGroupName(state)) {
      if (state.groupNames.indexOf(state.lastStringValue) !== -1) {
        state.raise("Duplicate capture group name");
      }
      state.groupNames.push(state.lastStringValue);
      return
    }
    state.raise("Invalid group");
  }
};

// GroupName[U] ::
//   `<` RegExpIdentifierName[?U] `>`
// Note: this updates `state.lastStringValue` property with the eaten name.
pp$9.regexp_eatGroupName = function(state) {
  state.lastStringValue = "";
  if (state.eat(0x3C /* < */)) {
    if (this.regexp_eatRegExpIdentifierName(state) && state.eat(0x3E /* > */)) {
      return true
    }
    state.raise("Invalid capture group name");
  }
  return false
};

// RegExpIdentifierName[U] ::
//   RegExpIdentifierStart[?U]
//   RegExpIdentifierName[?U] RegExpIdentifierPart[?U]
// Note: this updates `state.lastStringValue` property with the eaten name.
pp$9.regexp_eatRegExpIdentifierName = function(state) {
  state.lastStringValue = "";
  if (this.regexp_eatRegExpIdentifierStart(state)) {
    state.lastStringValue += codePointToString$1(state.lastIntValue);
    while (this.regexp_eatRegExpIdentifierPart(state)) {
      state.lastStringValue += codePointToString$1(state.lastIntValue);
    }
    return true
  }
  return false
};

// RegExpIdentifierStart[U] ::
//   UnicodeIDStart
//   `$`
//   `_`
//   `\` RegExpUnicodeEscapeSequence[?U]
pp$9.regexp_eatRegExpIdentifierStart = function(state) {
  var start = state.pos;
  var ch = state.current();
  state.advance();

  if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierStart(ch)) {
    state.lastIntValue = ch;
    return true
  }

  state.pos = start;
  return false
};
function isRegExpIdentifierStart(ch) {
  return isIdentifierStart(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */
}

// RegExpIdentifierPart[U] ::
//   UnicodeIDContinue
//   `$`
//   `_`
//   `\` RegExpUnicodeEscapeSequence[?U]
//   <ZWNJ>
//   <ZWJ>
pp$9.regexp_eatRegExpIdentifierPart = function(state) {
  var start = state.pos;
  var ch = state.current();
  state.advance();

  if (ch === 0x5C /* \ */ && this.regexp_eatRegExpUnicodeEscapeSequence(state)) {
    ch = state.lastIntValue;
  }
  if (isRegExpIdentifierPart(ch)) {
    state.lastIntValue = ch;
    return true
  }

  state.pos = start;
  return false
};
function isRegExpIdentifierPart(ch) {
  return isIdentifierChar(ch, true) || ch === 0x24 /* $ */ || ch === 0x5F /* _ */ || ch === 0x200C /* <ZWNJ> */ || ch === 0x200D /* <ZWJ> */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-AtomEscape
pp$9.regexp_eatAtomEscape = function(state) {
  if (
    this.regexp_eatBackReference(state) ||
    this.regexp_eatCharacterClassEscape(state) ||
    this.regexp_eatCharacterEscape(state) ||
    (state.switchN && this.regexp_eatKGroupName(state))
  ) {
    return true
  }
  if (state.switchU) {
    // Make the same message as V8.
    if (state.current() === 0x63 /* c */) {
      state.raise("Invalid unicode escape");
    }
    state.raise("Invalid escape");
  }
  return false
};
pp$9.regexp_eatBackReference = function(state) {
  var start = state.pos;
  if (this.regexp_eatDecimalEscape(state)) {
    var n = state.lastIntValue;
    if (state.switchU) {
      // For SyntaxError in https://www.ecma-international.org/ecma-262/8.0/#sec-atomescape
      if (n > state.maxBackReference) {
        state.maxBackReference = n;
      }
      return true
    }
    if (n <= state.numCapturingParens) {
      return true
    }
    state.pos = start;
  }
  return false
};
pp$9.regexp_eatKGroupName = function(state) {
  if (state.eat(0x6B /* k */)) {
    if (this.regexp_eatGroupName(state)) {
      state.backReferenceNames.push(state.lastStringValue);
      return true
    }
    state.raise("Invalid named reference");
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-CharacterEscape
pp$9.regexp_eatCharacterEscape = function(state) {
  return (
    this.regexp_eatControlEscape(state) ||
    this.regexp_eatCControlLetter(state) ||
    this.regexp_eatZero(state) ||
    this.regexp_eatHexEscapeSequence(state) ||
    this.regexp_eatRegExpUnicodeEscapeSequence(state) ||
    (!state.switchU && this.regexp_eatLegacyOctalEscapeSequence(state)) ||
    this.regexp_eatIdentityEscape(state)
  )
};
pp$9.regexp_eatCControlLetter = function(state) {
  var start = state.pos;
  if (state.eat(0x63 /* c */)) {
    if (this.regexp_eatControlLetter(state)) {
      return true
    }
    state.pos = start;
  }
  return false
};
pp$9.regexp_eatZero = function(state) {
  if (state.current() === 0x30 /* 0 */ && !isDecimalDigit(state.lookahead())) {
    state.lastIntValue = 0;
    state.advance();
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ControlEscape
pp$9.regexp_eatControlEscape = function(state) {
  var ch = state.current();
  if (ch === 0x74 /* t */) {
    state.lastIntValue = 0x09; /* \t */
    state.advance();
    return true
  }
  if (ch === 0x6E /* n */) {
    state.lastIntValue = 0x0A; /* \n */
    state.advance();
    return true
  }
  if (ch === 0x76 /* v */) {
    state.lastIntValue = 0x0B; /* \v */
    state.advance();
    return true
  }
  if (ch === 0x66 /* f */) {
    state.lastIntValue = 0x0C; /* \f */
    state.advance();
    return true
  }
  if (ch === 0x72 /* r */) {
    state.lastIntValue = 0x0D; /* \r */
    state.advance();
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ControlLetter
pp$9.regexp_eatControlLetter = function(state) {
  var ch = state.current();
  if (isControlLetter(ch)) {
    state.lastIntValue = ch % 0x20;
    state.advance();
    return true
  }
  return false
};
function isControlLetter(ch) {
  return (
    (ch >= 0x41 /* A */ && ch <= 0x5A /* Z */) ||
    (ch >= 0x61 /* a */ && ch <= 0x7A /* z */)
  )
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-RegExpUnicodeEscapeSequence
pp$9.regexp_eatRegExpUnicodeEscapeSequence = function(state) {
  var start = state.pos;

  if (state.eat(0x75 /* u */)) {
    if (this.regexp_eatFixedHexDigits(state, 4)) {
      var lead = state.lastIntValue;
      if (state.switchU && lead >= 0xD800 && lead <= 0xDBFF) {
        var leadSurrogateEnd = state.pos;
        if (state.eat(0x5C /* \ */) && state.eat(0x75 /* u */) && this.regexp_eatFixedHexDigits(state, 4)) {
          var trail = state.lastIntValue;
          if (trail >= 0xDC00 && trail <= 0xDFFF) {
            state.lastIntValue = (lead - 0xD800) * 0x400 + (trail - 0xDC00) + 0x10000;
            return true
          }
        }
        state.pos = leadSurrogateEnd;
        state.lastIntValue = lead;
      }
      return true
    }
    if (
      state.switchU &&
      state.eat(0x7B /* { */) &&
      this.regexp_eatHexDigits(state) &&
      state.eat(0x7D /* } */) &&
      isValidUnicode(state.lastIntValue)
    ) {
      return true
    }
    if (state.switchU) {
      state.raise("Invalid unicode escape");
    }
    state.pos = start;
  }

  return false
};
function isValidUnicode(ch) {
  return ch >= 0 && ch <= 0x10FFFF
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-IdentityEscape
pp$9.regexp_eatIdentityEscape = function(state) {
  if (state.switchU) {
    if (this.regexp_eatSyntaxCharacter(state)) {
      return true
    }
    if (state.eat(0x2F /* / */)) {
      state.lastIntValue = 0x2F; /* / */
      return true
    }
    return false
  }

  var ch = state.current();
  if (ch !== 0x63 /* c */ && (!state.switchN || ch !== 0x6B /* k */)) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }

  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalEscape
pp$9.regexp_eatDecimalEscape = function(state) {
  state.lastIntValue = 0;
  var ch = state.current();
  if (ch >= 0x31 /* 1 */ && ch <= 0x39 /* 9 */) {
    do {
      state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
      state.advance();
    } while ((ch = state.current()) >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */)
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClassEscape
pp$9.regexp_eatCharacterClassEscape = function(state) {
  var ch = state.current();

  if (isCharacterClassEscape(ch)) {
    state.lastIntValue = -1;
    state.advance();
    return true
  }

  if (
    state.switchU &&
    this.options.ecmaVersion >= 9 &&
    (ch === 0x50 /* P */ || ch === 0x70 /* p */)
  ) {
    state.lastIntValue = -1;
    state.advance();
    if (
      state.eat(0x7B /* { */) &&
      this.regexp_eatUnicodePropertyValueExpression(state) &&
      state.eat(0x7D /* } */)
    ) {
      return true
    }
    state.raise("Invalid property name");
  }

  return false
};
function isCharacterClassEscape(ch) {
  return (
    ch === 0x64 /* d */ ||
    ch === 0x44 /* D */ ||
    ch === 0x73 /* s */ ||
    ch === 0x53 /* S */ ||
    ch === 0x77 /* w */ ||
    ch === 0x57 /* W */
  )
}

// UnicodePropertyValueExpression ::
//   UnicodePropertyName `=` UnicodePropertyValue
//   LoneUnicodePropertyNameOrValue
pp$9.regexp_eatUnicodePropertyValueExpression = function(state) {
  var start = state.pos;

  // UnicodePropertyName `=` UnicodePropertyValue
  if (this.regexp_eatUnicodePropertyName(state) && state.eat(0x3D /* = */)) {
    var name = state.lastStringValue;
    if (this.regexp_eatUnicodePropertyValue(state)) {
      var value = state.lastStringValue;
      this.regexp_validateUnicodePropertyNameAndValue(state, name, value);
      return true
    }
  }
  state.pos = start;

  // LoneUnicodePropertyNameOrValue
  if (this.regexp_eatLoneUnicodePropertyNameOrValue(state)) {
    var nameOrValue = state.lastStringValue;
    this.regexp_validateUnicodePropertyNameOrValue(state, nameOrValue);
    return true
  }
  return false
};
pp$9.regexp_validateUnicodePropertyNameAndValue = function(state, name, value) {
  if (!has(state.unicodeProperties.nonBinary, name))
    { state.raise("Invalid property name"); }
  if (!state.unicodeProperties.nonBinary[name].test(value))
    { state.raise("Invalid property value"); }
};
pp$9.regexp_validateUnicodePropertyNameOrValue = function(state, nameOrValue) {
  if (!state.unicodeProperties.binary.test(nameOrValue))
    { state.raise("Invalid property name"); }
};

// UnicodePropertyName ::
//   UnicodePropertyNameCharacters
pp$9.regexp_eatUnicodePropertyName = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyNameCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString$1(ch);
    state.advance();
  }
  return state.lastStringValue !== ""
};
function isUnicodePropertyNameCharacter(ch) {
  return isControlLetter(ch) || ch === 0x5F /* _ */
}

// UnicodePropertyValue ::
//   UnicodePropertyValueCharacters
pp$9.regexp_eatUnicodePropertyValue = function(state) {
  var ch = 0;
  state.lastStringValue = "";
  while (isUnicodePropertyValueCharacter(ch = state.current())) {
    state.lastStringValue += codePointToString$1(ch);
    state.advance();
  }
  return state.lastStringValue !== ""
};
function isUnicodePropertyValueCharacter(ch) {
  return isUnicodePropertyNameCharacter(ch) || isDecimalDigit(ch)
}

// LoneUnicodePropertyNameOrValue ::
//   UnicodePropertyValueCharacters
pp$9.regexp_eatLoneUnicodePropertyNameOrValue = function(state) {
  return this.regexp_eatUnicodePropertyValue(state)
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-CharacterClass
pp$9.regexp_eatCharacterClass = function(state) {
  if (state.eat(0x5B /* [ */)) {
    state.eat(0x5E /* ^ */);
    this.regexp_classRanges(state);
    if (state.eat(0x5D /* [ */)) {
      return true
    }
    // Unreachable since it threw "unterminated regular expression" error before.
    state.raise("Unterminated character class");
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassRanges
// https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRanges
// https://www.ecma-international.org/ecma-262/8.0/#prod-NonemptyClassRangesNoDash
pp$9.regexp_classRanges = function(state) {
  var this$1 = this;

  while (this.regexp_eatClassAtom(state)) {
    var left = state.lastIntValue;
    if (state.eat(0x2D /* - */) && this$1.regexp_eatClassAtom(state)) {
      var right = state.lastIntValue;
      if (state.switchU && (left === -1 || right === -1)) {
        state.raise("Invalid character class");
      }
      if (left !== -1 && right !== -1 && left > right) {
        state.raise("Range out of order in character class");
      }
    }
  }
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtom
// https://www.ecma-international.org/ecma-262/8.0/#prod-ClassAtomNoDash
pp$9.regexp_eatClassAtom = function(state) {
  var start = state.pos;

  if (state.eat(0x5C /* \ */)) {
    if (this.regexp_eatClassEscape(state)) {
      return true
    }
    if (state.switchU) {
      // Make the same message as V8.
      var ch$1 = state.current();
      if (ch$1 === 0x63 /* c */ || isOctalDigit(ch$1)) {
        state.raise("Invalid class escape");
      }
      state.raise("Invalid escape");
    }
    state.pos = start;
  }

  var ch = state.current();
  if (ch !== 0x5D /* [ */) {
    state.lastIntValue = ch;
    state.advance();
    return true
  }

  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassEscape
pp$9.regexp_eatClassEscape = function(state) {
  var start = state.pos;

  if (state.eat(0x62 /* b */)) {
    state.lastIntValue = 0x08; /* <BS> */
    return true
  }

  if (state.switchU && state.eat(0x2D /* - */)) {
    state.lastIntValue = 0x2D; /* - */
    return true
  }

  if (!state.switchU && state.eat(0x63 /* c */)) {
    if (this.regexp_eatClassControlLetter(state)) {
      return true
    }
    state.pos = start;
  }

  return (
    this.regexp_eatCharacterClassEscape(state) ||
    this.regexp_eatCharacterEscape(state)
  )
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-ClassControlLetter
pp$9.regexp_eatClassControlLetter = function(state) {
  var ch = state.current();
  if (isDecimalDigit(ch) || ch === 0x5F /* _ */) {
    state.lastIntValue = ch % 0x20;
    state.advance();
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
pp$9.regexp_eatHexEscapeSequence = function(state) {
  var start = state.pos;
  if (state.eat(0x78 /* x */)) {
    if (this.regexp_eatFixedHexDigits(state, 2)) {
      return true
    }
    if (state.switchU) {
      state.raise("Invalid escape");
    }
    state.pos = start;
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-DecimalDigits
pp$9.regexp_eatDecimalDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isDecimalDigit(ch = state.current())) {
    state.lastIntValue = 10 * state.lastIntValue + (ch - 0x30 /* 0 */);
    state.advance();
  }
  return state.pos !== start
};
function isDecimalDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigits
pp$9.regexp_eatHexDigits = function(state) {
  var start = state.pos;
  var ch = 0;
  state.lastIntValue = 0;
  while (isHexDigit(ch = state.current())) {
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return state.pos !== start
};
function isHexDigit(ch) {
  return (
    (ch >= 0x30 /* 0 */ && ch <= 0x39 /* 9 */) ||
    (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) ||
    (ch >= 0x61 /* a */ && ch <= 0x66 /* f */)
  )
}
function hexToInt(ch) {
  if (ch >= 0x41 /* A */ && ch <= 0x46 /* F */) {
    return 10 + (ch - 0x41 /* A */)
  }
  if (ch >= 0x61 /* a */ && ch <= 0x66 /* f */) {
    return 10 + (ch - 0x61 /* a */)
  }
  return ch - 0x30 /* 0 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-annexB-LegacyOctalEscapeSequence
// Allows only 0-377(octal) i.e. 0-255(decimal).
pp$9.regexp_eatLegacyOctalEscapeSequence = function(state) {
  if (this.regexp_eatOctalDigit(state)) {
    var n1 = state.lastIntValue;
    if (this.regexp_eatOctalDigit(state)) {
      var n2 = state.lastIntValue;
      if (n1 <= 3 && this.regexp_eatOctalDigit(state)) {
        state.lastIntValue = n1 * 64 + n2 * 8 + state.lastIntValue;
      } else {
        state.lastIntValue = n1 * 8 + n2;
      }
    } else {
      state.lastIntValue = n1;
    }
    return true
  }
  return false
};

// https://www.ecma-international.org/ecma-262/8.0/#prod-OctalDigit
pp$9.regexp_eatOctalDigit = function(state) {
  var ch = state.current();
  if (isOctalDigit(ch)) {
    state.lastIntValue = ch - 0x30; /* 0 */
    state.advance();
    return true
  }
  state.lastIntValue = 0;
  return false
};
function isOctalDigit(ch) {
  return ch >= 0x30 /* 0 */ && ch <= 0x37 /* 7 */
}

// https://www.ecma-international.org/ecma-262/8.0/#prod-Hex4Digits
// https://www.ecma-international.org/ecma-262/8.0/#prod-HexDigit
// And HexDigit HexDigit in https://www.ecma-international.org/ecma-262/8.0/#prod-HexEscapeSequence
pp$9.regexp_eatFixedHexDigits = function(state, length) {
  var start = state.pos;
  state.lastIntValue = 0;
  for (var i = 0; i < length; ++i) {
    var ch = state.current();
    if (!isHexDigit(ch)) {
      state.pos = start;
      return false
    }
    state.lastIntValue = 16 * state.lastIntValue + hexToInt(ch);
    state.advance();
  }
  return true
};

// Object type used to represent tokens. Note that normally, tokens
// simply exist as properties on the parser object. This is only
// used for the onToken callback and the external tokenizer.

var Token = function Token(p) {
  this.type = p.type;
  this.value = p.value;
  this.start = p.start;
  this.end = p.end;
  if (p.options.locations)
    { this.loc = new SourceLocation(p, p.startLoc, p.endLoc); }
  if (p.options.ranges)
    { this.range = [p.start, p.end]; }
};

// ## Tokenizer

var pp$8 = Parser.prototype;

// Move to the next token

pp$8.next = function() {
  if (this.options.onToken)
    { this.options.onToken(new Token(this)); }

  this.lastTokEnd = this.end;
  this.lastTokStart = this.start;
  this.lastTokEndLoc = this.endLoc;
  this.lastTokStartLoc = this.startLoc;
  this.nextToken();
};

pp$8.getToken = function() {
  this.next();
  return new Token(this)
};

// If we're in an ES6 environment, make parsers iterable
if (typeof Symbol !== "undefined")
  { pp$8[Symbol.iterator] = function() {
    var this$1 = this;

    return {
      next: function () {
        var token = this$1.getToken();
        return {
          done: token.type === types.eof,
          value: token
        }
      }
    }
  }; }

// Toggle strict mode. Re-reads the next number or string to please
// pedantic tests (`"use strict"; 010;` should fail).

pp$8.curContext = function() {
  return this.context[this.context.length - 1]
};

// Read a single token, updating the parser object's token-related
// properties.

pp$8.nextToken = function() {
  var curContext = this.curContext();
  if (!curContext || !curContext.preserveSpace) { this.skipSpace(); }

  this.start = this.pos;
  if (this.options.locations) { this.startLoc = this.curPosition(); }
  if (this.pos >= this.input.length) { return this.finishToken(types.eof) }

  if (curContext.override) { return curContext.override(this) }
  else { this.readToken(this.fullCharCodeAtPos()); }
};

pp$8.readToken = function(code) {
  // Identifier or keyword. '\uXXXX' sequences are allowed in
  // identifiers, so '\' also dispatches to that.
  if (isIdentifierStart(code, this.options.ecmaVersion >= 6) || code === 92 /* '\' */)
    { return this.readWord() }

  return this.getTokenFromCode(code)
};

pp$8.fullCharCodeAtPos = function() {
  var code = this.input.charCodeAt(this.pos);
  if (code <= 0xd7ff || code >= 0xe000) { return code }
  var next = this.input.charCodeAt(this.pos + 1);
  return (code << 10) + next - 0x35fdc00
};

pp$8.skipBlockComment = function() {
  var this$1 = this;

  var startLoc = this.options.onComment && this.curPosition();
  var start = this.pos, end = this.input.indexOf("*/", this.pos += 2);
  if (end === -1) { this.raise(this.pos - 2, "Unterminated comment"); }
  this.pos = end + 2;
  if (this.options.locations) {
    lineBreakG.lastIndex = start;
    var match;
    while ((match = lineBreakG.exec(this.input)) && match.index < this.pos) {
      ++this$1.curLine;
      this$1.lineStart = match.index + match[0].length;
    }
  }
  if (this.options.onComment)
    { this.options.onComment(true, this.input.slice(start + 2, end), start, this.pos,
                           startLoc, this.curPosition()); }
};

pp$8.skipLineComment = function(startSkip) {
  var this$1 = this;

  var start = this.pos;
  var startLoc = this.options.onComment && this.curPosition();
  var ch = this.input.charCodeAt(this.pos += startSkip);
  while (this.pos < this.input.length && !isNewLine(ch)) {
    ch = this$1.input.charCodeAt(++this$1.pos);
  }
  if (this.options.onComment)
    { this.options.onComment(false, this.input.slice(start + startSkip, this.pos), start, this.pos,
                           startLoc, this.curPosition()); }
};

// Called at the start of the parse and after every token. Skips
// whitespace and comments, and.

pp$8.skipSpace = function() {
  var this$1 = this;

  loop: while (this.pos < this.input.length) {
    var ch = this$1.input.charCodeAt(this$1.pos);
    switch (ch) {
    case 32: case 160: // ' '
      ++this$1.pos;
      break
    case 13:
      if (this$1.input.charCodeAt(this$1.pos + 1) === 10) {
        ++this$1.pos;
      }
    case 10: case 8232: case 8233:
      ++this$1.pos;
      if (this$1.options.locations) {
        ++this$1.curLine;
        this$1.lineStart = this$1.pos;
      }
      break
    case 47: // '/'
      switch (this$1.input.charCodeAt(this$1.pos + 1)) {
      case 42: // '*'
        this$1.skipBlockComment();
        break
      case 47:
        this$1.skipLineComment(2);
        break
      default:
        break loop
      }
      break
    default:
      if (ch > 8 && ch < 14 || ch >= 5760 && nonASCIIwhitespace.test(String.fromCharCode(ch))) {
        ++this$1.pos;
      } else {
        break loop
      }
    }
  }
};

// Called at the end of every token. Sets `end`, `val`, and
// maintains `context` and `exprAllowed`, and skips the space after
// the token, so that the next one's `start` will point at the
// right position.

pp$8.finishToken = function(type, val) {
  this.end = this.pos;
  if (this.options.locations) { this.endLoc = this.curPosition(); }
  var prevType = this.type;
  this.type = type;
  this.value = val;

  this.updateContext(prevType);
};

// ### Token reading

// This is the function that is called to fetch the next token. It
// is somewhat obscure, because it works in character codes rather
// than characters, and because operator parsing has been inlined
// into it.
//
// All in the name of speed.
//
pp$8.readToken_dot = function() {
  var next = this.input.charCodeAt(this.pos + 1);
  if (next >= 48 && next <= 57) { return this.readNumber(true) }
  var next2 = this.input.charCodeAt(this.pos + 2);
  if (this.options.ecmaVersion >= 6 && next === 46 && next2 === 46) { // 46 = dot '.'
    this.pos += 3;
    return this.finishToken(types.ellipsis)
  } else {
    ++this.pos;
    return this.finishToken(types.dot)
  }
};

pp$8.readToken_slash = function() { // '/'
  var next = this.input.charCodeAt(this.pos + 1);
  if (this.exprAllowed) { ++this.pos; return this.readRegexp() }
  if (next === 61) { return this.finishOp(types.assign, 2) }
  return this.finishOp(types.slash, 1)
};

pp$8.readToken_mult_modulo_exp = function(code) { // '%*'
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  var tokentype = code === 42 ? types.star : types.modulo;

  // exponentiation operator ** and **=
  if (this.options.ecmaVersion >= 7 && code === 42 && next === 42) {
    ++size;
    tokentype = types.starstar;
    next = this.input.charCodeAt(this.pos + 2);
  }

  if (next === 61) { return this.finishOp(types.assign, size + 1) }
  return this.finishOp(tokentype, size)
};

pp$8.readToken_pipe_amp = function(code) { // '|&'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) { return this.finishOp(code === 124 ? types.logicalOR : types.logicalAND, 2) }
  if (next === 61) { return this.finishOp(types.assign, 2) }
  return this.finishOp(code === 124 ? types.bitwiseOR : types.bitwiseAND, 1)
};

pp$8.readToken_caret = function() { // '^'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) { return this.finishOp(types.assign, 2) }
  return this.finishOp(types.bitwiseXOR, 1)
};

pp$8.readToken_plus_min = function(code) { // '+-'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === code) {
    if (next === 45 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 62 &&
        (this.lastTokEnd === 0 || lineBreak.test(this.input.slice(this.lastTokEnd, this.pos)))) {
      // A `-->` line comment
      this.skipLineComment(3);
      this.skipSpace();
      return this.nextToken()
    }
    return this.finishOp(types.incDec, 2)
  }
  if (next === 61) { return this.finishOp(types.assign, 2) }
  return this.finishOp(types.plusMin, 1)
};

pp$8.readToken_lt_gt = function(code) { // '<>'
  var next = this.input.charCodeAt(this.pos + 1);
  var size = 1;
  if (next === code) {
    size = code === 62 && this.input.charCodeAt(this.pos + 2) === 62 ? 3 : 2;
    if (this.input.charCodeAt(this.pos + size) === 61) { return this.finishOp(types.assign, size + 1) }
    return this.finishOp(types.bitShift, size)
  }
  if (next === 33 && code === 60 && !this.inModule && this.input.charCodeAt(this.pos + 2) === 45 &&
      this.input.charCodeAt(this.pos + 3) === 45) {
    // `<!--`, an XML-style comment that should be interpreted as a line comment
    this.skipLineComment(4);
    this.skipSpace();
    return this.nextToken()
  }
  if (next === 61) { size = 2; }
  return this.finishOp(types.relational, size)
};

pp$8.readToken_eq_excl = function(code) { // '=!'
  var next = this.input.charCodeAt(this.pos + 1);
  if (next === 61) { return this.finishOp(types.equality, this.input.charCodeAt(this.pos + 2) === 61 ? 3 : 2) }
  if (code === 61 && next === 62 && this.options.ecmaVersion >= 6) { // '=>'
    this.pos += 2;
    return this.finishToken(types.arrow)
  }
  return this.finishOp(code === 61 ? types.eq : types.prefix, 1)
};

pp$8.getTokenFromCode = function(code) {
  switch (code) {
  // The interpretation of a dot depends on whether it is followed
  // by a digit or another two dots.
  case 46: // '.'
    return this.readToken_dot()

  // Punctuation tokens.
  case 40: ++this.pos; return this.finishToken(types.parenL)
  case 41: ++this.pos; return this.finishToken(types.parenR)
  case 59: ++this.pos; return this.finishToken(types.semi)
  case 44: ++this.pos; return this.finishToken(types.comma)
  case 91: ++this.pos; return this.finishToken(types.bracketL)
  case 93: ++this.pos; return this.finishToken(types.bracketR)
  case 123: ++this.pos; return this.finishToken(types.braceL)
  case 125: ++this.pos; return this.finishToken(types.braceR)
  case 58: ++this.pos; return this.finishToken(types.colon)
  case 63: ++this.pos; return this.finishToken(types.question)

  case 96: // '`'
    if (this.options.ecmaVersion < 6) { break }
    ++this.pos;
    return this.finishToken(types.backQuote)

  case 48: // '0'
    var next = this.input.charCodeAt(this.pos + 1);
    if (next === 120 || next === 88) { return this.readRadixNumber(16) } // '0x', '0X' - hex number
    if (this.options.ecmaVersion >= 6) {
      if (next === 111 || next === 79) { return this.readRadixNumber(8) } // '0o', '0O' - octal number
      if (next === 98 || next === 66) { return this.readRadixNumber(2) } // '0b', '0B' - binary number
    }

  // Anything else beginning with a digit is an integer, octal
  // number, or float.
  case 49: case 50: case 51: case 52: case 53: case 54: case 55: case 56: case 57: // 1-9
    return this.readNumber(false)

  // Quotes produce strings.
  case 34: case 39: // '"', "'"
    return this.readString(code)

  // Operators are parsed inline in tiny state machines. '=' (61) is
  // often referred to. `finishOp` simply skips the amount of
  // characters it is given as second argument, and returns a token
  // of the type given by its first argument.

  case 47: // '/'
    return this.readToken_slash()

  case 37: case 42: // '%*'
    return this.readToken_mult_modulo_exp(code)

  case 124: case 38: // '|&'
    return this.readToken_pipe_amp(code)

  case 94: // '^'
    return this.readToken_caret()

  case 43: case 45: // '+-'
    return this.readToken_plus_min(code)

  case 60: case 62: // '<>'
    return this.readToken_lt_gt(code)

  case 61: case 33: // '=!'
    return this.readToken_eq_excl(code)

  case 126: // '~'
    return this.finishOp(types.prefix, 1)
  }

  this.raise(this.pos, "Unexpected character '" + codePointToString(code) + "'");
};

pp$8.finishOp = function(type, size) {
  var str = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finishToken(type, str)
};

pp$8.readRegexp = function() {
  var this$1 = this;

  var escaped, inClass, start = this.pos;
  for (;;) {
    if (this$1.pos >= this$1.input.length) { this$1.raise(start, "Unterminated regular expression"); }
    var ch = this$1.input.charAt(this$1.pos);
    if (lineBreak.test(ch)) { this$1.raise(start, "Unterminated regular expression"); }
    if (!escaped) {
      if (ch === "[") { inClass = true; }
      else if (ch === "]" && inClass) { inClass = false; }
      else if (ch === "/" && !inClass) { break }
      escaped = ch === "\\";
    } else { escaped = false; }
    ++this$1.pos;
  }
  var pattern = this.input.slice(start, this.pos);
  ++this.pos;
  var flagsStart = this.pos;
  var flags = this.readWord1();
  if (this.containsEsc) { this.unexpected(flagsStart); }

  // Validate pattern
  var state = this.regexpState || (this.regexpState = new RegExpValidationState(this));
  state.reset(start, pattern, flags);
  this.validateRegExpFlags(state);
  this.validateRegExpPattern(state);

  // Create Literal#value property value.
  var value = null;
  try {
    value = new RegExp(pattern, flags);
  } catch (e) {
    // ESTree requires null if it failed to instantiate RegExp object.
    // https://github.com/estree/estree/blob/a27003adf4fd7bfad44de9cef372a2eacd527b1c/es5.md#regexpliteral
  }

  return this.finishToken(types.regexp, {pattern: pattern, flags: flags, value: value})
};

// Read an integer in the given radix. Return null if zero digits
// were read, the integer value otherwise. When `len` is given, this
// will return `null` unless the integer has exactly `len` digits.

pp$8.readInt = function(radix, len) {
  var this$1 = this;

  var start = this.pos, total = 0;
  for (var i = 0, e = len == null ? Infinity : len; i < e; ++i) {
    var code = this$1.input.charCodeAt(this$1.pos), val = (void 0);
    if (code >= 97) { val = code - 97 + 10; } // a
    else if (code >= 65) { val = code - 65 + 10; } // A
    else if (code >= 48 && code <= 57) { val = code - 48; } // 0-9
    else { val = Infinity; }
    if (val >= radix) { break }
    ++this$1.pos;
    total = total * radix + val;
  }
  if (this.pos === start || len != null && this.pos - start !== len) { return null }

  return total
};

pp$8.readRadixNumber = function(radix) {
  this.pos += 2; // 0x
  var val = this.readInt(radix);
  if (val == null) { this.raise(this.start + 2, "Expected number in radix " + radix); }
  if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }
  return this.finishToken(types.num, val)
};

// Read an integer, octal integer, or floating-point number.

pp$8.readNumber = function(startsWithDot) {
  var start = this.pos;
  if (!startsWithDot && this.readInt(10) === null) { this.raise(start, "Invalid number"); }
  var octal = this.pos - start >= 2 && this.input.charCodeAt(start) === 48;
  if (octal && this.strict) { this.raise(start, "Invalid number"); }
  if (octal && /[89]/.test(this.input.slice(start, this.pos))) { octal = false; }
  var next = this.input.charCodeAt(this.pos);
  if (next === 46 && !octal) { // '.'
    ++this.pos;
    this.readInt(10);
    next = this.input.charCodeAt(this.pos);
  }
  if ((next === 69 || next === 101) && !octal) { // 'eE'
    next = this.input.charCodeAt(++this.pos);
    if (next === 43 || next === 45) { ++this.pos; } // '+-'
    if (this.readInt(10) === null) { this.raise(start, "Invalid number"); }
  }
  if (isIdentifierStart(this.fullCharCodeAtPos())) { this.raise(this.pos, "Identifier directly after number"); }

  var str = this.input.slice(start, this.pos);
  var val = octal ? parseInt(str, 8) : parseFloat(str);
  return this.finishToken(types.num, val)
};

// Read a string value, interpreting backslash-escapes.

pp$8.readCodePoint = function() {
  var ch = this.input.charCodeAt(this.pos), code;

  if (ch === 123) { // '{'
    if (this.options.ecmaVersion < 6) { this.unexpected(); }
    var codePos = ++this.pos;
    code = this.readHexChar(this.input.indexOf("}", this.pos) - this.pos);
    ++this.pos;
    if (code > 0x10FFFF) { this.invalidStringToken(codePos, "Code point out of bounds"); }
  } else {
    code = this.readHexChar(4);
  }
  return code
};

function codePointToString(code) {
  // UTF-16 Decoding
  if (code <= 0xFFFF) { return String.fromCharCode(code) }
  code -= 0x10000;
  return String.fromCharCode((code >> 10) + 0xD800, (code & 1023) + 0xDC00)
}

pp$8.readString = function(quote) {
  var this$1 = this;

  var out = "", chunkStart = ++this.pos;
  for (;;) {
    if (this$1.pos >= this$1.input.length) { this$1.raise(this$1.start, "Unterminated string constant"); }
    var ch = this$1.input.charCodeAt(this$1.pos);
    if (ch === quote) { break }
    if (ch === 92) { // '\'
      out += this$1.input.slice(chunkStart, this$1.pos);
      out += this$1.readEscapedChar(false);
      chunkStart = this$1.pos;
    } else {
      if (isNewLine(ch, this$1.options.ecmaVersion >= 10)) { this$1.raise(this$1.start, "Unterminated string constant"); }
      ++this$1.pos;
    }
  }
  out += this.input.slice(chunkStart, this.pos++);
  return this.finishToken(types.string, out)
};

// Reads template string tokens.

var INVALID_TEMPLATE_ESCAPE_ERROR = {};

pp$8.tryReadTemplateToken = function() {
  this.inTemplateElement = true;
  try {
    this.readTmplToken();
  } catch (err) {
    if (err === INVALID_TEMPLATE_ESCAPE_ERROR) {
      this.readInvalidTemplateToken();
    } else {
      throw err
    }
  }

  this.inTemplateElement = false;
};

pp$8.invalidStringToken = function(position, message) {
  if (this.inTemplateElement && this.options.ecmaVersion >= 9) {
    throw INVALID_TEMPLATE_ESCAPE_ERROR
  } else {
    this.raise(position, message);
  }
};

pp$8.readTmplToken = function() {
  var this$1 = this;

  var out = "", chunkStart = this.pos;
  for (;;) {
    if (this$1.pos >= this$1.input.length) { this$1.raise(this$1.start, "Unterminated template"); }
    var ch = this$1.input.charCodeAt(this$1.pos);
    if (ch === 96 || ch === 36 && this$1.input.charCodeAt(this$1.pos + 1) === 123) { // '`', '${'
      if (this$1.pos === this$1.start && (this$1.type === types.template || this$1.type === types.invalidTemplate)) {
        if (ch === 36) {
          this$1.pos += 2;
          return this$1.finishToken(types.dollarBraceL)
        } else {
          ++this$1.pos;
          return this$1.finishToken(types.backQuote)
        }
      }
      out += this$1.input.slice(chunkStart, this$1.pos);
      return this$1.finishToken(types.template, out)
    }
    if (ch === 92) { // '\'
      out += this$1.input.slice(chunkStart, this$1.pos);
      out += this$1.readEscapedChar(true);
      chunkStart = this$1.pos;
    } else if (isNewLine(ch)) {
      out += this$1.input.slice(chunkStart, this$1.pos);
      ++this$1.pos;
      switch (ch) {
      case 13:
        if (this$1.input.charCodeAt(this$1.pos) === 10) { ++this$1.pos; }
      case 10:
        out += "\n";
        break
      default:
        out += String.fromCharCode(ch);
        break
      }
      if (this$1.options.locations) {
        ++this$1.curLine;
        this$1.lineStart = this$1.pos;
      }
      chunkStart = this$1.pos;
    } else {
      ++this$1.pos;
    }
  }
};

// Reads a template token to search for the end, without validating any escape sequences
pp$8.readInvalidTemplateToken = function() {
  var this$1 = this;

  for (; this.pos < this.input.length; this.pos++) {
    switch (this$1.input[this$1.pos]) {
    case "\\":
      ++this$1.pos;
      break

    case "$":
      if (this$1.input[this$1.pos + 1] !== "{") {
        break
      }
    // falls through

    case "`":
      return this$1.finishToken(types.invalidTemplate, this$1.input.slice(this$1.start, this$1.pos))

    // no default
    }
  }
  this.raise(this.start, "Unterminated template");
};

// Used to read escaped characters

pp$8.readEscapedChar = function(inTemplate) {
  var ch = this.input.charCodeAt(++this.pos);
  ++this.pos;
  switch (ch) {
  case 110: return "\n" // 'n' -> '\n'
  case 114: return "\r" // 'r' -> '\r'
  case 120: return String.fromCharCode(this.readHexChar(2)) // 'x'
  case 117: return codePointToString(this.readCodePoint()) // 'u'
  case 116: return "\t" // 't' -> '\t'
  case 98: return "\b" // 'b' -> '\b'
  case 118: return "\u000b" // 'v' -> '\u000b'
  case 102: return "\f" // 'f' -> '\f'
  case 13: if (this.input.charCodeAt(this.pos) === 10) { ++this.pos; } // '\r\n'
  case 10: // ' \n'
    if (this.options.locations) { this.lineStart = this.pos; ++this.curLine; }
    return ""
  default:
    if (ch >= 48 && ch <= 55) {
      var octalStr = this.input.substr(this.pos - 1, 3).match(/^[0-7]+/)[0];
      var octal = parseInt(octalStr, 8);
      if (octal > 255) {
        octalStr = octalStr.slice(0, -1);
        octal = parseInt(octalStr, 8);
      }
      this.pos += octalStr.length - 1;
      ch = this.input.charCodeAt(this.pos);
      if ((octalStr !== "0" || ch === 56 || ch === 57) && (this.strict || inTemplate)) {
        this.invalidStringToken(
          this.pos - 1 - octalStr.length,
          inTemplate
            ? "Octal literal in template string"
            : "Octal literal in strict mode"
        );
      }
      return String.fromCharCode(octal)
    }
    if (isNewLine(ch)) {
      // Unicode new line characters after \ get removed from output in both
      // template literals and strings
      return ""
    }
    return String.fromCharCode(ch)
  }
};

// Used to read character escape sequences ('\x', '\u', '\U').

pp$8.readHexChar = function(len) {
  var codePos = this.pos;
  var n = this.readInt(16, len);
  if (n === null) { this.invalidStringToken(codePos, "Bad character escape sequence"); }
  return n
};

// Read an identifier, and return it as a string. Sets `this.containsEsc`
// to whether the word contained a '\u' escape.
//
// Incrementally adds only escaped chars, adding other chunks as-is
// as a micro-optimization.

pp$8.readWord1 = function() {
  var this$1 = this;

  this.containsEsc = false;
  var word = "", first = true, chunkStart = this.pos;
  var astral = this.options.ecmaVersion >= 6;
  while (this.pos < this.input.length) {
    var ch = this$1.fullCharCodeAtPos();
    if (isIdentifierChar(ch, astral)) {
      this$1.pos += ch <= 0xffff ? 1 : 2;
    } else if (ch === 92) { // "\"
      this$1.containsEsc = true;
      word += this$1.input.slice(chunkStart, this$1.pos);
      var escStart = this$1.pos;
      if (this$1.input.charCodeAt(++this$1.pos) !== 117) // "u"
        { this$1.invalidStringToken(this$1.pos, "Expecting Unicode escape sequence \\uXXXX"); }
      ++this$1.pos;
      var esc = this$1.readCodePoint();
      if (!(first ? isIdentifierStart : isIdentifierChar)(esc, astral))
        { this$1.invalidStringToken(escStart, "Invalid Unicode escape"); }
      word += codePointToString(esc);
      chunkStart = this$1.pos;
    } else {
      break
    }
    first = false;
  }
  return word + this.input.slice(chunkStart, this.pos)
};

// Read an identifier or keyword token. Will check for reserved
// words when necessary.

pp$8.readWord = function() {
  var word = this.readWord1();
  var type = types.name;
  if (this.keywords.test(word)) {
    if (this.containsEsc) { this.raiseRecoverable(this.start, "Escape sequence in keyword " + word); }
    type = keywords$1[word];
  }
  return this.finishToken(type, word)
};

// Acorn is a tiny, fast JavaScript parser written in JavaScript.
//
// Acorn was written by Marijn Haverbeke, Ingvar Stepanyan, and
// various contributors and released under an MIT license.
//
// Git repositories for Acorn are available at
//
//     http://marijnhaverbeke.nl/git/acorn
//     https://github.com/acornjs/acorn.git
//
// Please use the [github bug tracker][ghbt] to report issues.
//
// [ghbt]: https://github.com/acornjs/acorn/issues
//
// [walk]: util/walk.js

var version = "6.1.1";

// The main exported interface (under `self.acorn` when in the
// browser) is a `parse` function that takes a code string and
// returns an abstract syntax tree as specified by [Mozilla parser
// API][api].
//
// [api]: https://developer.mozilla.org/en-US/docs/SpiderMonkey/Parser_API

function parse(input, options) {
  return Parser.parse(input, options)
}

// This function tries to parse a single expression at a given
// offset in a string. Useful for parsing mixed-language formats
// that embed JavaScript expressions.

function parseExpressionAt(input, pos, options) {
  return Parser.parseExpressionAt(input, pos, options)
}

// Acorn is organized as a tokenizer and a recursive-descent parser.
// The `tokenizer` export provides an interface to the tokenizer.

function tokenizer(input, options) {
  return Parser.tokenizer(input, options)
}

exports.version = version;
exports.parse = parse;
exports.parseExpressionAt = parseExpressionAt;
exports.tokenizer = tokenizer;
exports.Parser = Parser;
exports.defaultOptions = defaultOptions;
exports.Position = Position;
exports.SourceLocation = SourceLocation;
exports.getLineInfo = getLineInfo;
exports.Node = Node;
exports.TokenType = TokenType;
exports.tokTypes = types;
exports.keywordTypes = keywords$1;
exports.TokContext = TokContext;
exports.tokContexts = types$1;
exports.isIdentifierChar = isIdentifierChar;
exports.isIdentifierStart = isIdentifierStart;
exports.Token = Token;
exports.isNewLine = isNewLine;
exports.lineBreak = lineBreak;
exports.lineBreakG = lineBreakG;
exports.nonASCIIwhitespace = nonASCIIwhitespace;

Object.defineProperty(exports, '__esModule', { value: true });

})));


},{}],15:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"dup":14}],16:[function(require,module,exports){
/*
 A JavaScript implementation of the SHA family of hashes, as
 defined in FIPS PUB 180-4 and FIPS PUB 202, as well as the corresponding
 HMAC implementation as defined in FIPS PUB 198a

 Copyright Brian Turek 2008-2017
 Distributed under the BSD License
 See http://caligatio.github.com/jsSHA/ for more information

 Several functions taken from Paul Johnston
*/
'use strict';(function(Y){function C(c,a,b){var e=0,h=[],n=0,g,l,d,f,m,q,u,r,I=!1,v=[],w=[],t,y=!1,z=!1,x=-1;b=b||{};g=b.encoding||"UTF8";t=b.numRounds||1;if(t!==parseInt(t,10)||1>t)throw Error("numRounds must a integer >= 1");if("SHA-1"===c)m=512,q=K,u=Z,f=160,r=function(a){return a.slice()};else if(0===c.lastIndexOf("SHA-",0))if(q=function(a,b){return L(a,b,c)},u=function(a,b,h,e){var k,f;if("SHA-224"===c||"SHA-256"===c)k=(b+65>>>9<<4)+15,f=16;else if("SHA-384"===c||"SHA-512"===c)k=(b+129>>>10<<
5)+31,f=32;else throw Error("Unexpected error in SHA-2 implementation");for(;a.length<=k;)a.push(0);a[b>>>5]|=128<<24-b%32;b=b+h;a[k]=b&4294967295;a[k-1]=b/4294967296|0;h=a.length;for(b=0;b<h;b+=f)e=L(a.slice(b,b+f),e,c);if("SHA-224"===c)a=[e[0],e[1],e[2],e[3],e[4],e[5],e[6]];else if("SHA-256"===c)a=e;else if("SHA-384"===c)a=[e[0].a,e[0].b,e[1].a,e[1].b,e[2].a,e[2].b,e[3].a,e[3].b,e[4].a,e[4].b,e[5].a,e[5].b];else if("SHA-512"===c)a=[e[0].a,e[0].b,e[1].a,e[1].b,e[2].a,e[2].b,e[3].a,e[3].b,e[4].a,
e[4].b,e[5].a,e[5].b,e[6].a,e[6].b,e[7].a,e[7].b];else throw Error("Unexpected error in SHA-2 implementation");return a},r=function(a){return a.slice()},"SHA-224"===c)m=512,f=224;else if("SHA-256"===c)m=512,f=256;else if("SHA-384"===c)m=1024,f=384;else if("SHA-512"===c)m=1024,f=512;else throw Error("Chosen SHA variant is not supported");else if(0===c.lastIndexOf("SHA3-",0)||0===c.lastIndexOf("SHAKE",0)){var F=6;q=D;r=function(a){var c=[],e;for(e=0;5>e;e+=1)c[e]=a[e].slice();return c};x=1;if("SHA3-224"===
c)m=1152,f=224;else if("SHA3-256"===c)m=1088,f=256;else if("SHA3-384"===c)m=832,f=384;else if("SHA3-512"===c)m=576,f=512;else if("SHAKE128"===c)m=1344,f=-1,F=31,z=!0;else if("SHAKE256"===c)m=1088,f=-1,F=31,z=!0;else throw Error("Chosen SHA variant is not supported");u=function(a,c,e,b,h){e=m;var k=F,f,g=[],n=e>>>5,l=0,d=c>>>5;for(f=0;f<d&&c>=e;f+=n)b=D(a.slice(f,f+n),b),c-=e;a=a.slice(f);for(c%=e;a.length<n;)a.push(0);f=c>>>3;a[f>>2]^=k<<f%4*8;a[n-1]^=2147483648;for(b=D(a,b);32*g.length<h;){a=b[l%
5][l/5|0];g.push(a.b);if(32*g.length>=h)break;g.push(a.a);l+=1;0===64*l%e&&D(null,b)}return g}}else throw Error("Chosen SHA variant is not supported");d=M(a,g,x);l=A(c);this.setHMACKey=function(a,b,h){var k;if(!0===I)throw Error("HMAC key already set");if(!0===y)throw Error("Cannot set HMAC key after calling update");if(!0===z)throw Error("SHAKE is not supported for HMAC");g=(h||{}).encoding||"UTF8";b=M(b,g,x)(a);a=b.binLen;b=b.value;k=m>>>3;h=k/4-1;if(k<a/8){for(b=u(b,a,0,A(c),f);b.length<=h;)b.push(0);
b[h]&=4294967040}else if(k>a/8){for(;b.length<=h;)b.push(0);b[h]&=4294967040}for(a=0;a<=h;a+=1)v[a]=b[a]^909522486,w[a]=b[a]^1549556828;l=q(v,l);e=m;I=!0};this.update=function(a){var c,b,k,f=0,g=m>>>5;c=d(a,h,n);a=c.binLen;b=c.value;c=a>>>5;for(k=0;k<c;k+=g)f+m<=a&&(l=q(b.slice(k,k+g),l),f+=m);e+=f;h=b.slice(f>>>5);n=a%m;y=!0};this.getHash=function(a,b){var k,g,d,m;if(!0===I)throw Error("Cannot call getHash after setting HMAC key");d=N(b);if(!0===z){if(-1===d.shakeLen)throw Error("shakeLen must be specified in options");
f=d.shakeLen}switch(a){case "HEX":k=function(a){return O(a,f,x,d)};break;case "B64":k=function(a){return P(a,f,x,d)};break;case "BYTES":k=function(a){return Q(a,f,x)};break;case "ARRAYBUFFER":try{g=new ArrayBuffer(0)}catch(p){throw Error("ARRAYBUFFER not supported by this environment");}k=function(a){return R(a,f,x)};break;default:throw Error("format must be HEX, B64, BYTES, or ARRAYBUFFER");}m=u(h.slice(),n,e,r(l),f);for(g=1;g<t;g+=1)!0===z&&0!==f%32&&(m[m.length-1]&=16777215>>>24-f%32),m=u(m,f,
0,A(c),f);return k(m)};this.getHMAC=function(a,b){var k,g,d,p;if(!1===I)throw Error("Cannot call getHMAC without first setting HMAC key");d=N(b);switch(a){case "HEX":k=function(a){return O(a,f,x,d)};break;case "B64":k=function(a){return P(a,f,x,d)};break;case "BYTES":k=function(a){return Q(a,f,x)};break;case "ARRAYBUFFER":try{k=new ArrayBuffer(0)}catch(v){throw Error("ARRAYBUFFER not supported by this environment");}k=function(a){return R(a,f,x)};break;default:throw Error("outputFormat must be HEX, B64, BYTES, or ARRAYBUFFER");
}g=u(h.slice(),n,e,r(l),f);p=q(w,A(c));p=u(g,f,m,p,f);return k(p)}}function b(c,a){this.a=c;this.b=a}function O(c,a,b,e){var h="";a/=8;var n,g,d;d=-1===b?3:0;for(n=0;n<a;n+=1)g=c[n>>>2]>>>8*(d+n%4*b),h+="0123456789abcdef".charAt(g>>>4&15)+"0123456789abcdef".charAt(g&15);return e.outputUpper?h.toUpperCase():h}function P(c,a,b,e){var h="",n=a/8,g,d,p,f;f=-1===b?3:0;for(g=0;g<n;g+=3)for(d=g+1<n?c[g+1>>>2]:0,p=g+2<n?c[g+2>>>2]:0,p=(c[g>>>2]>>>8*(f+g%4*b)&255)<<16|(d>>>8*(f+(g+1)%4*b)&255)<<8|p>>>8*(f+
(g+2)%4*b)&255,d=0;4>d;d+=1)8*g+6*d<=a?h+="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charAt(p>>>6*(3-d)&63):h+=e.b64Pad;return h}function Q(c,a,b){var e="";a/=8;var h,d,g;g=-1===b?3:0;for(h=0;h<a;h+=1)d=c[h>>>2]>>>8*(g+h%4*b)&255,e+=String.fromCharCode(d);return e}function R(c,a,b){a/=8;var e,h=new ArrayBuffer(a),d,g;g=new Uint8Array(h);d=-1===b?3:0;for(e=0;e<a;e+=1)g[e]=c[e>>>2]>>>8*(d+e%4*b)&255;return h}function N(c){var a={outputUpper:!1,b64Pad:"=",shakeLen:-1};c=c||{};
a.outputUpper=c.outputUpper||!1;!0===c.hasOwnProperty("b64Pad")&&(a.b64Pad=c.b64Pad);if(!0===c.hasOwnProperty("shakeLen")){if(0!==c.shakeLen%8)throw Error("shakeLen must be a multiple of 8");a.shakeLen=c.shakeLen}if("boolean"!==typeof a.outputUpper)throw Error("Invalid outputUpper formatting option");if("string"!==typeof a.b64Pad)throw Error("Invalid b64Pad formatting option");return a}function M(c,a,b){switch(a){case "UTF8":case "UTF16BE":case "UTF16LE":break;default:throw Error("encoding must be UTF8, UTF16BE, or UTF16LE");
}switch(c){case "HEX":c=function(a,c,d){var g=a.length,l,p,f,m,q,u;if(0!==g%2)throw Error("String of HEX type must be in byte increments");c=c||[0];d=d||0;q=d>>>3;u=-1===b?3:0;for(l=0;l<g;l+=2){p=parseInt(a.substr(l,2),16);if(isNaN(p))throw Error("String of HEX type contains invalid characters");m=(l>>>1)+q;for(f=m>>>2;c.length<=f;)c.push(0);c[f]|=p<<8*(u+m%4*b)}return{value:c,binLen:4*g+d}};break;case "TEXT":c=function(c,h,d){var g,l,p=0,f,m,q,u,r,t;h=h||[0];d=d||0;q=d>>>3;if("UTF8"===a)for(t=-1===
b?3:0,f=0;f<c.length;f+=1)for(g=c.charCodeAt(f),l=[],128>g?l.push(g):2048>g?(l.push(192|g>>>6),l.push(128|g&63)):55296>g||57344<=g?l.push(224|g>>>12,128|g>>>6&63,128|g&63):(f+=1,g=65536+((g&1023)<<10|c.charCodeAt(f)&1023),l.push(240|g>>>18,128|g>>>12&63,128|g>>>6&63,128|g&63)),m=0;m<l.length;m+=1){r=p+q;for(u=r>>>2;h.length<=u;)h.push(0);h[u]|=l[m]<<8*(t+r%4*b);p+=1}else if("UTF16BE"===a||"UTF16LE"===a)for(t=-1===b?2:0,l="UTF16LE"===a&&1!==b||"UTF16LE"!==a&&1===b,f=0;f<c.length;f+=1){g=c.charCodeAt(f);
!0===l&&(m=g&255,g=m<<8|g>>>8);r=p+q;for(u=r>>>2;h.length<=u;)h.push(0);h[u]|=g<<8*(t+r%4*b);p+=2}return{value:h,binLen:8*p+d}};break;case "B64":c=function(a,c,d){var g=0,l,p,f,m,q,u,r,t;if(-1===a.search(/^[a-zA-Z0-9=+\/]+$/))throw Error("Invalid character in base-64 string");p=a.indexOf("=");a=a.replace(/\=/g,"");if(-1!==p&&p<a.length)throw Error("Invalid '=' found in base-64 string");c=c||[0];d=d||0;u=d>>>3;t=-1===b?3:0;for(p=0;p<a.length;p+=4){q=a.substr(p,4);for(f=m=0;f<q.length;f+=1)l="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".indexOf(q[f]),
m|=l<<18-6*f;for(f=0;f<q.length-1;f+=1){r=g+u;for(l=r>>>2;c.length<=l;)c.push(0);c[l]|=(m>>>16-8*f&255)<<8*(t+r%4*b);g+=1}}return{value:c,binLen:8*g+d}};break;case "BYTES":c=function(a,c,d){var g,l,p,f,m,q;c=c||[0];d=d||0;p=d>>>3;q=-1===b?3:0;for(l=0;l<a.length;l+=1)g=a.charCodeAt(l),m=l+p,f=m>>>2,c.length<=f&&c.push(0),c[f]|=g<<8*(q+m%4*b);return{value:c,binLen:8*a.length+d}};break;case "ARRAYBUFFER":try{c=new ArrayBuffer(0)}catch(e){throw Error("ARRAYBUFFER not supported by this environment");}c=
function(a,c,d){var g,l,p,f,m,q;c=c||[0];d=d||0;l=d>>>3;m=-1===b?3:0;q=new Uint8Array(a);for(g=0;g<a.byteLength;g+=1)f=g+l,p=f>>>2,c.length<=p&&c.push(0),c[p]|=q[g]<<8*(m+f%4*b);return{value:c,binLen:8*a.byteLength+d}};break;default:throw Error("format must be HEX, TEXT, B64, BYTES, or ARRAYBUFFER");}return c}function y(c,a){return c<<a|c>>>32-a}function S(c,a){return 32<a?(a-=32,new b(c.b<<a|c.a>>>32-a,c.a<<a|c.b>>>32-a)):0!==a?new b(c.a<<a|c.b>>>32-a,c.b<<a|c.a>>>32-a):c}function w(c,a){return c>>>
a|c<<32-a}function t(c,a){var k=null,k=new b(c.a,c.b);return k=32>=a?new b(k.a>>>a|k.b<<32-a&4294967295,k.b>>>a|k.a<<32-a&4294967295):new b(k.b>>>a-32|k.a<<64-a&4294967295,k.a>>>a-32|k.b<<64-a&4294967295)}function T(c,a){var k=null;return k=32>=a?new b(c.a>>>a,c.b>>>a|c.a<<32-a&4294967295):new b(0,c.a>>>a-32)}function aa(c,a,b){return c&a^~c&b}function ba(c,a,k){return new b(c.a&a.a^~c.a&k.a,c.b&a.b^~c.b&k.b)}function U(c,a,b){return c&a^c&b^a&b}function ca(c,a,k){return new b(c.a&a.a^c.a&k.a^a.a&
k.a,c.b&a.b^c.b&k.b^a.b&k.b)}function da(c){return w(c,2)^w(c,13)^w(c,22)}function ea(c){var a=t(c,28),k=t(c,34);c=t(c,39);return new b(a.a^k.a^c.a,a.b^k.b^c.b)}function fa(c){return w(c,6)^w(c,11)^w(c,25)}function ga(c){var a=t(c,14),k=t(c,18);c=t(c,41);return new b(a.a^k.a^c.a,a.b^k.b^c.b)}function ha(c){return w(c,7)^w(c,18)^c>>>3}function ia(c){var a=t(c,1),k=t(c,8);c=T(c,7);return new b(a.a^k.a^c.a,a.b^k.b^c.b)}function ja(c){return w(c,17)^w(c,19)^c>>>10}function ka(c){var a=t(c,19),k=t(c,61);
c=T(c,6);return new b(a.a^k.a^c.a,a.b^k.b^c.b)}function G(c,a){var b=(c&65535)+(a&65535);return((c>>>16)+(a>>>16)+(b>>>16)&65535)<<16|b&65535}function la(c,a,b,e){var h=(c&65535)+(a&65535)+(b&65535)+(e&65535);return((c>>>16)+(a>>>16)+(b>>>16)+(e>>>16)+(h>>>16)&65535)<<16|h&65535}function H(c,a,b,e,h){var d=(c&65535)+(a&65535)+(b&65535)+(e&65535)+(h&65535);return((c>>>16)+(a>>>16)+(b>>>16)+(e>>>16)+(h>>>16)+(d>>>16)&65535)<<16|d&65535}function ma(c,a){var d,e,h;d=(c.b&65535)+(a.b&65535);e=(c.b>>>16)+
(a.b>>>16)+(d>>>16);h=(e&65535)<<16|d&65535;d=(c.a&65535)+(a.a&65535)+(e>>>16);e=(c.a>>>16)+(a.a>>>16)+(d>>>16);return new b((e&65535)<<16|d&65535,h)}function na(c,a,d,e){var h,n,g;h=(c.b&65535)+(a.b&65535)+(d.b&65535)+(e.b&65535);n=(c.b>>>16)+(a.b>>>16)+(d.b>>>16)+(e.b>>>16)+(h>>>16);g=(n&65535)<<16|h&65535;h=(c.a&65535)+(a.a&65535)+(d.a&65535)+(e.a&65535)+(n>>>16);n=(c.a>>>16)+(a.a>>>16)+(d.a>>>16)+(e.a>>>16)+(h>>>16);return new b((n&65535)<<16|h&65535,g)}function oa(c,a,d,e,h){var n,g,l;n=(c.b&
65535)+(a.b&65535)+(d.b&65535)+(e.b&65535)+(h.b&65535);g=(c.b>>>16)+(a.b>>>16)+(d.b>>>16)+(e.b>>>16)+(h.b>>>16)+(n>>>16);l=(g&65535)<<16|n&65535;n=(c.a&65535)+(a.a&65535)+(d.a&65535)+(e.a&65535)+(h.a&65535)+(g>>>16);g=(c.a>>>16)+(a.a>>>16)+(d.a>>>16)+(e.a>>>16)+(h.a>>>16)+(n>>>16);return new b((g&65535)<<16|n&65535,l)}function B(c,a){return new b(c.a^a.a,c.b^a.b)}function A(c){var a=[],d;if("SHA-1"===c)a=[1732584193,4023233417,2562383102,271733878,3285377520];else if(0===c.lastIndexOf("SHA-",0))switch(a=
[3238371032,914150663,812702999,4144912697,4290775857,1750603025,1694076839,3204075428],d=[1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225],c){case "SHA-224":break;case "SHA-256":a=d;break;case "SHA-384":a=[new b(3418070365,a[0]),new b(1654270250,a[1]),new b(2438529370,a[2]),new b(355462360,a[3]),new b(1731405415,a[4]),new b(41048885895,a[5]),new b(3675008525,a[6]),new b(1203062813,a[7])];break;case "SHA-512":a=[new b(d[0],4089235720),new b(d[1],2227873595),
new b(d[2],4271175723),new b(d[3],1595750129),new b(d[4],2917565137),new b(d[5],725511199),new b(d[6],4215389547),new b(d[7],327033209)];break;default:throw Error("Unknown SHA variant");}else if(0===c.lastIndexOf("SHA3-",0)||0===c.lastIndexOf("SHAKE",0))for(c=0;5>c;c+=1)a[c]=[new b(0,0),new b(0,0),new b(0,0),new b(0,0),new b(0,0)];else throw Error("No SHA variants supported");return a}function K(c,a){var b=[],e,d,n,g,l,p,f;e=a[0];d=a[1];n=a[2];g=a[3];l=a[4];for(f=0;80>f;f+=1)b[f]=16>f?c[f]:y(b[f-
3]^b[f-8]^b[f-14]^b[f-16],1),p=20>f?H(y(e,5),d&n^~d&g,l,1518500249,b[f]):40>f?H(y(e,5),d^n^g,l,1859775393,b[f]):60>f?H(y(e,5),U(d,n,g),l,2400959708,b[f]):H(y(e,5),d^n^g,l,3395469782,b[f]),l=g,g=n,n=y(d,30),d=e,e=p;a[0]=G(e,a[0]);a[1]=G(d,a[1]);a[2]=G(n,a[2]);a[3]=G(g,a[3]);a[4]=G(l,a[4]);return a}function Z(c,a,b,e){var d;for(d=(a+65>>>9<<4)+15;c.length<=d;)c.push(0);c[a>>>5]|=128<<24-a%32;a+=b;c[d]=a&4294967295;c[d-1]=a/4294967296|0;a=c.length;for(d=0;d<a;d+=16)e=K(c.slice(d,d+16),e);return e}function L(c,
a,k){var e,h,n,g,l,p,f,m,q,u,r,t,v,w,y,A,z,x,F,B,C,D,E=[],J;if("SHA-224"===k||"SHA-256"===k)u=64,t=1,D=Number,v=G,w=la,y=H,A=ha,z=ja,x=da,F=fa,C=U,B=aa,J=d;else if("SHA-384"===k||"SHA-512"===k)u=80,t=2,D=b,v=ma,w=na,y=oa,A=ia,z=ka,x=ea,F=ga,C=ca,B=ba,J=V;else throw Error("Unexpected error in SHA-2 implementation");k=a[0];e=a[1];h=a[2];n=a[3];g=a[4];l=a[5];p=a[6];f=a[7];for(r=0;r<u;r+=1)16>r?(q=r*t,m=c.length<=q?0:c[q],q=c.length<=q+1?0:c[q+1],E[r]=new D(m,q)):E[r]=w(z(E[r-2]),E[r-7],A(E[r-15]),E[r-
16]),m=y(f,F(g),B(g,l,p),J[r],E[r]),q=v(x(k),C(k,e,h)),f=p,p=l,l=g,g=v(n,m),n=h,h=e,e=k,k=v(m,q);a[0]=v(k,a[0]);a[1]=v(e,a[1]);a[2]=v(h,a[2]);a[3]=v(n,a[3]);a[4]=v(g,a[4]);a[5]=v(l,a[5]);a[6]=v(p,a[6]);a[7]=v(f,a[7]);return a}function D(c,a){var d,e,h,n,g=[],l=[];if(null!==c)for(e=0;e<c.length;e+=2)a[(e>>>1)%5][(e>>>1)/5|0]=B(a[(e>>>1)%5][(e>>>1)/5|0],new b(c[e+1],c[e]));for(d=0;24>d;d+=1){n=A("SHA3-");for(e=0;5>e;e+=1){h=a[e][0];var p=a[e][1],f=a[e][2],m=a[e][3],q=a[e][4];g[e]=new b(h.a^p.a^f.a^
m.a^q.a,h.b^p.b^f.b^m.b^q.b)}for(e=0;5>e;e+=1)l[e]=B(g[(e+4)%5],S(g[(e+1)%5],1));for(e=0;5>e;e+=1)for(h=0;5>h;h+=1)a[e][h]=B(a[e][h],l[e]);for(e=0;5>e;e+=1)for(h=0;5>h;h+=1)n[h][(2*e+3*h)%5]=S(a[e][h],W[e][h]);for(e=0;5>e;e+=1)for(h=0;5>h;h+=1)a[e][h]=B(n[e][h],new b(~n[(e+1)%5][h].a&n[(e+2)%5][h].a,~n[(e+1)%5][h].b&n[(e+2)%5][h].b));a[0][0]=B(a[0][0],X[d])}return a}var d,V,W,X;d=[1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,
1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,
2227730452,2361852424,2428436474,2756734187,3204031479,3329325298];V=[new b(d[0],3609767458),new b(d[1],602891725),new b(d[2],3964484399),new b(d[3],2173295548),new b(d[4],4081628472),new b(d[5],3053834265),new b(d[6],2937671579),new b(d[7],3664609560),new b(d[8],2734883394),new b(d[9],1164996542),new b(d[10],1323610764),new b(d[11],3590304994),new b(d[12],4068182383),new b(d[13],991336113),new b(d[14],633803317),new b(d[15],3479774868),new b(d[16],2666613458),new b(d[17],944711139),new b(d[18],2341262773),
new b(d[19],2007800933),new b(d[20],1495990901),new b(d[21],1856431235),new b(d[22],3175218132),new b(d[23],2198950837),new b(d[24],3999719339),new b(d[25],766784016),new b(d[26],2566594879),new b(d[27],3203337956),new b(d[28],1034457026),new b(d[29],2466948901),new b(d[30],3758326383),new b(d[31],168717936),new b(d[32],1188179964),new b(d[33],1546045734),new b(d[34],1522805485),new b(d[35],2643833823),new b(d[36],2343527390),new b(d[37],1014477480),new b(d[38],1206759142),new b(d[39],344077627),
new b(d[40],1290863460),new b(d[41],3158454273),new b(d[42],3505952657),new b(d[43],106217008),new b(d[44],3606008344),new b(d[45],1432725776),new b(d[46],1467031594),new b(d[47],851169720),new b(d[48],3100823752),new b(d[49],1363258195),new b(d[50],3750685593),new b(d[51],3785050280),new b(d[52],3318307427),new b(d[53],3812723403),new b(d[54],2003034995),new b(d[55],3602036899),new b(d[56],1575990012),new b(d[57],1125592928),new b(d[58],2716904306),new b(d[59],442776044),new b(d[60],593698344),new b(d[61],
3733110249),new b(d[62],2999351573),new b(d[63],3815920427),new b(3391569614,3928383900),new b(3515267271,566280711),new b(3940187606,3454069534),new b(4118630271,4000239992),new b(116418474,1914138554),new b(174292421,2731055270),new b(289380356,3203993006),new b(460393269,320620315),new b(685471733,587496836),new b(852142971,1086792851),new b(1017036298,365543100),new b(1126000580,2618297676),new b(1288033470,3409855158),new b(1501505948,4234509866),new b(1607167915,987167468),new b(1816402316,
1246189591)];X=[new b(0,1),new b(0,32898),new b(2147483648,32906),new b(2147483648,2147516416),new b(0,32907),new b(0,2147483649),new b(2147483648,2147516545),new b(2147483648,32777),new b(0,138),new b(0,136),new b(0,2147516425),new b(0,2147483658),new b(0,2147516555),new b(2147483648,139),new b(2147483648,32905),new b(2147483648,32771),new b(2147483648,32770),new b(2147483648,128),new b(0,32778),new b(2147483648,2147483658),new b(2147483648,2147516545),new b(2147483648,32896),new b(0,2147483649),
new b(2147483648,2147516424)];W=[[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];"function"===typeof define&&define.amd?define(function(){return C}):"undefined"!==typeof exports?("undefined"!==typeof module&&module.exports&&(module.exports=C),exports=C):Y.jsSHA=C})(this);

},{}],17:[function(require,module,exports){
/**
 * GNU LibreJS - A browser add-on to block nonfree nontrivial JavaScript.
 * *
 * Copyright (C) 2011, 2012, 2013, 2014 Loic J. Duros
 * Copyright (C) 2014, 2015 Nik Nyby
 *
 * This file is part of GNU LibreJS.
 *
 * GNU LibreJS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * GNU LibreJS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with GNU LibreJS.  If not, see <http://www.gnu.org/licenses/>.
 */

exports.patternUtils = {
    /**
     * removeNonalpha
     *
     * Remove all nonalphanumeric values, except for
     * < and >, since they are what we use for tokens.
     *
     */
    removeNonalpha: function (str) {
	    var regex = /[^a-z0-9<>@]+/gi;
	    return str.replace(regex, '');
    },
    removeWhitespace: function (str) {
	    return str.replace(/\/\//gmi, '').replace(/\*/gmi, '').replace(/\s+/gmi, '');
    },
    replaceTokens: function (str) {
	    var regex = /<.*?>/gi;
	    return str.replace(regex, '.*?');
    }
};

},{}]},{},[12]);

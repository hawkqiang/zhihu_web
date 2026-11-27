/*
 * zhihu_web - HTML sanitising and list/detail rendering helpers.
 *
 * Answer bodies come from a third party, so everything is rebuilt from an
 * allowlist instead of being injected as-is: no scripts, no styles, no event
 * handlers, no iframes. Images are lazy and never carry a referrer.
 */
(function (global) {
  'use strict';

  var ALLOWED_TAGS = {
    P: 1, BR: 1, STRONG: 1, B: 1, EM: 1, I: 1, U: 1, DEL: 1, S: 1, MARK: 1,
    SMALL: 1, SUP: 1, SUB: 1, CODE: 1, PRE: 1, BLOCKQUOTE: 1, UL: 1, OL: 1,
    LI: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, HR: 1, FIGURE: 1,
    FIGCAPTION: 1, IMG: 1, A: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TD: 1,
    TH: 1, SPAN: 1, DIV: 1, DL: 1, DT: 1, DD: 1, SECTION: 1, ARTICLE: 1
  };

  var ALLOWED_ATTRS = {
    A: { href: 1, title: 1 },
    IMG: { src: 1, alt: 1, title: 1, width: 1, height: 1 },
    TD: { colspan: 1, rowspan: 1 },
    TH: { colspan: 1, rowspan: 1 },
    SPAN: { class: 1 },
    DIV: { class: 1 },
    CODE: { class: 1 },
    OL: { start: 1 },
    PRE: { class: 1 }
  };

  var DROP_WITH_CONTENT = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, FORM: 1, INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1, SVG: 1, MATH: 1, VIDEO: 1, AUDIO: 1, LINK: 1, META: 1, NOSCRIPT: 0 };

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function absoluteUrl(url) {
    if (!url) {
      return '';
    }
    if (url.indexOf('//') === 0) {
      return 'https:' + url;
    }
    if (url.indexOf('http://') === 0) {
      return 'https://' + url.slice(7);
    }
    if (url.charAt(0) === '/') {
      return 'https://www.zhihu.com' + url;
    }
    return url;
  }

  function imageSource(img) {
    if (!img) return '';
    // 知乎正文真实大图存储在 data-actualsrc / data-original，而 src 往往是空白占位符
    var actual = img.getAttribute('data-actualsrc') ||
      img.getAttribute('data-original') ||
      img.getAttribute('data-default-watermark-src') ||
      img.getAttribute('data-src');
    if (actual && actual.indexOf('data:') !== 0) {
      return absoluteUrl(actual);
    }
    var src = img.getAttribute('src') || '';
    if (src && src.indexOf('data:') !== 0) {
      return absoluteUrl(src);
    }
    return '';
  }

  function extractFirstImage(html) {
    if (!html) return '';
    var match = html.match(/data-actualsrc=["']([^"']+)["']/i) ||
      html.match(/data-original=["']([^"']+)["']/i) ||
      html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1] && match[1].indexOf('data:') !== 0) {
      return absoluteUrl(match[1]);
    }
    return '';
  }

  function cleanAttributes(source, tagName) {
    var allowed = ALLOWED_ATTRS[tagName] || {};
    var target = document.createElement(tagName);
    for (var i = 0; i < source.attributes.length; i += 1) {
      var attr = source.attributes[i];
      var name = attr.name.toLowerCase();
      if (!allowed[name]) {
        continue;
      }
      if (name === 'href' && /^\s*(javascript|data):/i.test(attr.value)) {
        continue;
      }
      target.setAttribute(name, attr.value);
    }
    return target;
  }

  function appendChildren(source, target) {
    var lastImgSrc = '';
    for (var child = source.firstChild; child; child = child.nextSibling) {
      var converted = convertNode(child);
      if (converted) {
        if (converted.tagName === 'IMG') {
          var curSrc = converted.getAttribute('src');
          if (curSrc && curSrc === lastImgSrc) {
            continue;
          }
          lastImgSrc = curSrc;
        } else {
          lastImgSrc = '';
        }
        target.appendChild(converted);
      }
    }
  }

  function convertNode(node) {
    if (node.nodeType === 3) {
      return document.createTextNode(node.nodeValue);
    }
    if (node.nodeType !== 1) {
      return null;
    }
    var tag = node.tagName.toUpperCase();
    if (tag === 'NOSCRIPT') {
      // Zhihu wraps its lazy-loaded images in <noscript>; keep the payload.
      var fragment = document.createDocumentFragment();
      var holder = document.createElement('div');
      holder.innerHTML = node.textContent || '';
      appendChildren(holder, fragment);
      return fragment.childNodes.length ? fragment : null;
    }
    if (DROP_WITH_CONTENT[tag] === 1) {
      return null;
    }
    if (!ALLOWED_TAGS[tag]) {
      // Unknown inline element: keep its text, drop the wrapper.
      var plain = document.createDocumentFragment();
      appendChildren(node, plain);
      return plain;
    }
    if (tag === 'IMG') {
      var src = imageSource(node);
      if (!src) {
        return null;
      }
      var image = cleanAttributes(node, 'IMG');
      image.setAttribute('src', src);
      return image;
    }
    var element = cleanAttributes(node, tag);
    if (tag === 'A') {
      var href = absoluteUrl(node.getAttribute('href') || '');
      if (href) {
        element.setAttribute('href', href);
      }
    }
    appendChildren(node, element);
    return element;
  }

  /** Turn untrusted Zhihu HTML into a safe DocumentFragment. */
  function sanitize(html, options) {
    var opts = options || {};
    var fragment = document.createDocumentFragment();
    if (!html) {
      return fragment;
    }
    var template = document.createElement('template');
    template.innerHTML = String(html);
    var source = template.content || template;

    var holder = document.createElement('div');
    appendChildren(source, holder);

    // Image policy: swap pictures for a tap-to-load slot when images are off.
    if (opts.images === false) {
      var images = holder.querySelectorAll('img');
      for (var i = 0; i < images.length; i += 1) {
        var img = images[i];
        var slot = document.createElement('span');
        slot.className = 'image-slot';
        slot.setAttribute('data-src', img.getAttribute('src') || '');
        slot.textContent = '图片已隐藏 · 点击加载';
        img.parentNode.replaceChild(slot, img);
      }
    }

    while (holder.firstChild) {
      fragment.appendChild(holder.firstChild);
    }
    return fragment;
  }

  /** Wire links inside sanitised content to internal routes or the shell. */
  function decorate(container) {
    if (!container) {
      return;
    }
    var images = container.querySelectorAll('img');
    for (var i = 0; i < images.length; i += 1) {
      var img = images[i];
      img.loading = 'lazy';
      img.decoding = 'async';
      img.setAttribute('referrerpolicy', 'no-referrer');
    }
    var links = container.querySelectorAll('a[href]');
    for (var j = 0; j < links.length; j += 1) {
      var link = links[j];
      var href = link.getAttribute('href');
      var route = internalRoute(href);
      if (route) {
        link.setAttribute('href', route);
        link.setAttribute('data-route-link', '1');
      } else {
        link.setAttribute('data-external', '1');
        link.setAttribute('title', href);
      }
    }
  }

  /** Map a Zhihu URL to an in-app route, if this reader knows how to show it. */
  function internalRoute(href) {
    if (!href) {
      return '';
    }
    var url;
    try {
      url = new URL(href, 'https://www.zhihu.com');
    } catch (error) {
      return '';
    }
    if (url.hostname === 'link.zhihu.com') {
      var target = url.searchParams.get('target');
      return target ? internalRoute(target) : '';
    }
    if (!/(^|\.)zhihu\.com$/.test(url.hostname)) {
      return '';
    }
    var answer = url.pathname.match(/^\/question\/(\d+)\/answer\/(\d+)/);
    if (answer) {
      return '#/a/' + answer[2];
    }
    var question = url.pathname.match(/^\/question\/(\d+)/);
    if (question) {
      return '#/q/' + question[1];
    }
    var article = url.pathname.match(/^\/p\/(\d+)/);
    if (article) {
      return '#/art/' + article[1];
    }
    return '';
  }

  // ------------------------------------------------------------- formatting

  function textOf(html) {
    var holder = document.createElement('div');
    holder.innerHTML = String(html || '');
    return (holder.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function excerptOf(value, limit) {
    var text = textOf(value);
    var max = limit || 160;
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  function compactNumber(value) {
    var number = Number(value || 0);
    if (!isFinite(number)) {
      return '0';
    }
    if (number >= 10000) {
      var wan = number / 10000;
      return (wan >= 100 ? Math.round(wan) : wan.toFixed(1)) + ' 万';
    }
    return String(number);
  }

  function timeAgo(seconds) {
    var value = Number(seconds || 0);
    if (!value) {
      return '';
    }
    var date = new Date(value * 1000);
    var diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) {
      return '刚刚';
    }
    if (diff < 3600) {
      return Math.floor(diff / 60) + ' 分钟前';
    }
    if (diff < 86400) {
      return Math.floor(diff / 3600) + ' 小时前';
    }
    if (diff < 86400 * 30) {
      return Math.floor(diff / 86400) + ' 天前';
    }
    return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
  }

  // ---------------------------------------------------------- normalisation

  function questionIdFromUrl(url) {
    var match = String(url || '').match(/question\/(\d+)/);
    return match ? match[1] : '';
  }

  function normalizeOne(raw, source) {
    if (!raw) {
      return null;
    }
    if (source === 'hot') {
      if (!raw.target) {
        return null;
      }
      var hotTarget = raw.target;
      // Zhihu app endpoint: /topstory/hot-list returns a feed_specific object
      // rather than the desktop web API's plain HotListItem.
      if (hotTarget.title_area) {
        var titleArea = hotTarget.title_area || {};
        var imageArea = hotTarget.image_area || {};
        var excerptArea = hotTarget.excerpt_area || {};
        var metricsArea = hotTarget.metrics_area || {};
        var hotLink = hotTarget.link || {};
        return {
          kind: 'question',
          id: questionIdFromUrl(hotLink.url),
          title: titleArea.text || '',
          excerpt: excerptArea.text || '',
          metrics: metricsArea.text || '',
          image: imageArea.url || '',
          source: 'hot'
        };
      }
      if (!hotTarget.title) {
        return null;
      }
      return {
        kind: 'question',
        id: questionIdFromUrl(hotTarget.link && hotTarget.link.url),
        title: hotTarget.title,
        excerpt: hotTarget.excerpt || hotTarget.detail_text || '',
        metrics: hotTarget.metrics_area ? hotTarget.metrics_area.text : '',
        image: hotTarget.image_url || '',
        source: 'hot'
      };
    }

    if (source === 'feed' && raw.type === 'hot_list_feed') {
      return normalizeOne(raw, 'hot');
    }

    if (source === 'search') {
      var object = raw.object || (raw.type === 'search_result' ? null : raw);
      if (!object) {
        return null;
      }
      var objectType = object.type || '';
      if (objectType === 'answer') {
        var qObj = object.question || {};
        var qIdStr = qObj.id ? String(qObj.id) : '';
        return {
          kind: qIdStr ? 'question' : 'answer',
          id: qIdStr || String(object.id || ''),
          answerId: qIdStr ? String(object.id || '') : '',
          questionId: qIdStr,
          title: qObj.name || qObj.title || object.title || '',
          excerpt: object.excerpt || object.content || '',
          author: object.author ? object.author.name : '',
          votes: object.voteup_count || 0,
          comments: object.comment_count || 0,
          source: 'search'
        };
      }
      if (objectType === 'article') {
        return {
          kind: 'article',
          id: String(object.id || ''),
          title: object.title || '',
          excerpt: object.excerpt || object.content || '',
          author: object.author ? object.author.name : '',
          votes: object.voteup_count || 0,
          comments: object.comment_count || 0,
          source: 'search'
        };
      }
      return null;
    }

    var target = raw.target || raw;
    var type = target.type || '';
    var author = target.author || {};
    if (type === 'answer') {
      var q = target.question || {};
      var qId = q.id ? String(q.id) : '';
      return {
        kind: qId ? 'question' : 'answer',
        id: qId || String(target.id || ''),
        answerId: qId ? String(target.id || '') : '',
        questionId: qId,
        title: q.title || target.title || '',
        excerpt: target.excerpt || target.content || '',
        image: target.thumbnail || target.image_url || extractFirstImage(target.content) || '',
        author: author.name || '',
        headline: author.headline || '',
        avatar: author.avatar_url || '',
        votes: target.voteup_count || 0,
        comments: target.comment_count || 0,
        time: target.created_time || target.updated_time || 0,
        source: source
      };
    }
    if (type === 'article') {
      return {
        kind: 'article',
        id: String(target.id || ''),
        title: target.title || '',
        excerpt: target.excerpt || target.content || '',
        image: target.image_url || target.thumbnail || extractFirstImage(target.content) || '',
        author: author.name || '',
        headline: author.headline || '',
        avatar: author.avatar_url || '',
        votes: target.voteup_count || 0,
        comments: target.comment_count || 0,
        time: target.created_time || 0,
        source: source
      };
    }
    if (type === 'zvideo') {
      return {
        kind: 'zvideo',
        id: String(target.id || ''),
        title: target.title || '',
        excerpt: target.excerpt || '',
        author: author.name || '',
        votes: target.voteup_count || 0,
        comments: target.comment_count || 0,
        url: target.video && target.video.playlist ? '' : '',
        source: source
      };
    }
    if (type === 'question' && target.title) {
      return {
        kind: 'question',
        id: String(target.id || ''),
        title: target.title,
        excerpt: target.excerpt || target.detail || '',
        votes: 0,
        comments: target.comment_count || 0,
        source: source
      };
    }
    return null;
  }

  function normalize(items, source) {
    var output = [];
    for (var i = 0; i < (items || []).length; i += 1) {
      var item = normalizeOne(items[i], source);
      if (item && (item.title || item.excerpt)) {
        output.push(item);
      }
    }
    return output;
  }

  function routeFor(item) {
    if (!item) {
      return '';
    }
    if (item.kind === 'question' && item.id) {
      return '#/q/' + item.id;
    }
    if (item.kind === 'answer' && item.id) {
      return '#/a/' + item.id;
    }
    if (item.kind === 'article' && item.id) {
      return '#/art/' + item.id;
    }
    return '';
  }

  function badgeLabel(item) {
    if (item.kind === 'answer') {
      return '回答';
    }
    if (item.kind === 'article') {
      return '文章';
    }
    if (item.kind === 'zvideo') {
      return '视频';
    }
    return '问题';
  }

  /** Build a list card element. */
  function card(item) {
    var thread = document.createElement('article');
    thread.className = 'card';
    var route = routeFor(item);
    thread.setAttribute('data-route', route);
    if (route) {
      thread.tabIndex = 0;
    } else {
      thread.classList.add('card-static');
    }

    var badge = item.kind === 'question' ? '' :
      '<span class="badge">' + badgeLabel(item) + '</span>';

    var meta = [];
    if (item.author) {
      meta.push('<span class="meta-author">' + escapeHtml(item.author) + '</span>');
    }
    if (item.votes) {
      meta.push('<span>赞同 ' + compactNumber(item.votes) + '</span>');
    }
    if (item.comments) {
      meta.push('<span>' + compactNumber(item.comments) + ' 评论</span>');
    }
    if (item.time) {
      meta.push('<span>' + timeAgo(item.time) + '</span>');
    }

    var thumbHtml = item.image ?
      '<div class="card-thumb"><img src="' + escapeHtml(item.image) + '" loading="lazy" referrerpolicy="no-referrer" alt=""></div>' : '';

    thread.innerHTML =
      '<div class="card-head">' + badge +
      '<h3 class="card-title">' + escapeHtml(item.title || excerptOf(item.excerpt, 80)) + '</h3>' +
      '</div>' +
      '<div class="card-body-wrap">' +
      '<div class="card-main-text">' +
      (item.excerpt ? '<p class="card-excerpt">' + escapeHtml(excerptOf(item.excerpt, 170)) + '</p>' : '') +
      (item.metrics ? '<p class="card-metrics">' + escapeHtml(item.metrics) + '</p>' : '') +
      (meta.length ? '<div class="card-meta">' + meta.join('') + '</div>' : '') +
      '</div>' +
      thumbHtml +
      '</div>';
    return thread;
  }

  global.ZW = global.ZW || {};
  global.ZW.render = {
    escapeHtml: escapeHtml,
    sanitize: sanitize,
    decorate: decorate,
    internalRoute: internalRoute,
    excerptOf: excerptOf,
    textOf: textOf,
    compactNumber: compactNumber,
    timeAgo: timeAgo,
    normalize: normalize,
    routeFor: routeFor,
    card: card
  };
})(window);

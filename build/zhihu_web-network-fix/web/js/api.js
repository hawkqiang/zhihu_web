/*
 * zhihu_web - thin client for Zhihu's public web endpoints.
 *
 * Requests are shaped like the upstream project (huamurui/zhihu-minus-minus):
 * cookie session + x-zse-96 signature + x-requested-with, only the API subset
 * this reader needs. Nothing is scraped, nothing is republished.
 */
(function (global) {
  'use strict';

  var BASE = 'https://www.zhihu.com';
  var APP_BASE = 'https://api.zhihu.com';
  var UA = 'ZhihuHybrid/1.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

  var QUESTION_INCLUDE = 'detail,excerpt,answer_count,comment_count,follower_count,visit_count,topics,relationship.is_following';
  var ANSWER_INCLUDE = 'content,editable_content,paid_info,can_comment,excerpt,thanks_count,voteup_count,comment_count,visited_count,reaction,ip_info,question.topics,author.is_following,reaction.relation.voting,segment_infos,endorsements,favlists_count,relationship.is_favorited';
  var ANSWER_LIST_INCLUDE = 'content,excerpt,voteup_count,comment_count,thanks_count,created_time,updated_time,author.name,author.headline,author.avatar_url,author.url_token,is_collapsed,relationship.vote,question.id,question.title';

  function cookieValue(cookie, name) {
    if (!cookie) {
      return '';
    }
    var parts = cookie.split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      var index = part.indexOf('=');
      if (index > 0 && part.slice(0, index).trim() === name) {
        return part.slice(index + 1).trim();
      }
    }
    return '';
  }

  function ApiError(message, status, payload) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status || 0;
    this.code = payload && payload.error ? payload.error.code : 0;
    this.needLogin = !!(payload && payload.error && payload.error.need_login);
    this.payload = payload;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function describe(status, payload) {
    if (status === 401) {
      return '知乎要求登录后查看（401）';
    }
    if (status === 403) {
      var code = payload && payload.error ? payload.error.code : 0;
      if (code === 40353 || (payload && payload.error && payload.error.need_login)) {
        return '知乎要求登录后查看该内容（403）';
      }
      if (code === 40362) {
        return '被知乎风控拦截（40362），请先在“内置浏览器”中打开一次知乎';
      }
      return '请求被知乎拒绝（403）';
    }
    if (status === 404) {
      return '内容不存在或已被删除（404）';
    }
    if (status === 429) {
      return '请求过于频繁，请稍后再试（429）';
    }
    if (status >= 500) {
      return '知乎服务暂时不可用（' + status + '）';
    }
    return '知乎接口返回 ' + status;
  }

  var session = { cookie: '', dc0: '', signedIn: false, name: '', avatar: '' };

  async function headersFor(path) {
    var cookies = session.cookie;
    var dc0 = session.dc0;
    var headers = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      'User-Agent': UA,
      Referer: BASE + '/',
      'x-requested-with': 'fetch'
    };
    if (cookies) {
      headers.Cookie = cookies;
    }
    var xsrf = cookieValue(cookies, '_xsrf');
    if (xsrf) {
      headers['x-xsrftoken'] = xsrf;
    }
    if (dc0) {
      headers['x-udid'] = dc0.split('|')[0];
      headers['x-zse-93'] = global.ZW.ZSE_VERSION;
      headers['x-zse-96'] = global.ZW.sign96(path, dc0);
    }
    return headers;
  }

  async function refreshSession() {
    try {
      var result = await global.ZW.host.cookies(BASE);
      session.cookie = result && result.cookie ? result.cookie : '';
      session.dc0 = cookieValue(session.cookie, 'd_c0');
      session.signedIn = !!cookieValue(session.cookie, 'z_c0');
    } catch (error) {
      session.cookie = '';
      session.dc0 = '';
      session.signedIn = false;
    }
    return session;
  }

  function appHeaders(path, query) {
    var headers = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
      'User-Agent': UA,
      'x-requested-with': 'fetch',
      'x-app-za': 'OS=Web',
      'x-api-version': '3.0.93',
      'x-page-id': '172'
    };
    if (path === '/topstory/recommend') {
      headers['x-api-version'] = '3.1.8';
      headers['x-page-id'] = '44';
      headers['x-close-recommend'] = '0';
      headers['x-feed-prefetch'] = '0';
    } else if (path === '/moments_v3') {
      headers['x-api-version'] = '3.0.93';
      headers['x-page-id'] = '43';
      headers['x-moments-ab-param'] = 'follow_tab=1';
    } else if (/^\/questions\/[^/]+\/feeds$/.test(path)) {
      headers['x-api-version'] = '3.0.89';
      headers['x-page-id'] = '172';
    }
    if (session.cookie) {
      headers.Cookie = session.cookie;
      var xsrf = cookieValue(session.cookie, '_xsrf');
      if (xsrf) {
        headers['x-xsrftoken'] = xsrf;
      }
    }
    return headers;
  }

  async function appRaw(path, query) {
    var suffix = query ? '?' + new URLSearchParams(query).toString() : '';
    var url = APP_BASE + path + suffix;
    var response = await global.ZW.host.request({
      url: url,
      method: 'GET',
      headers: appHeaders(path, query)
    });
    var payload = null;
    try {
      payload = response.text ? JSON.parse(response.text) : null;
    } catch (error) {
      payload = null;
    }
    if (response.status >= 200 && response.status < 300 && payload) {
      return payload;
    }
    var code = payload && payload.error ? payload.error.code : 0;
    var message = (payload && payload.error && payload.error.message) || describe(response.status, payload);
    if (response.status === 403 && code === 40362) {
      message = '知乎触发访问风控（40362）。可登录账号，或稍后再试；本应用不会绕过验证。';
    }
    throw new ApiError(message, response.status, payload);
  }

  async function appRawWithInclude(path, query, include) {
    var params = {};
    Object.keys(query || {}).forEach(function (key) { params[key] = query[key]; });
    if (include) {
      params.include = include;
    }
    try {
      return await appRaw(path, params);
    } catch (error) {
      // Unknown enum / include values change across app API revisions. Retry
      // once without include, but never alter authentication or abuse checks.
      if (include && error.status === 403 && error.code === 10003) {
        delete params.include;
        return await appRaw(path, params);
      }
      throw error;
    }
  }

  // --------------------------------------------------------------- requests

  async function raw(path) {
    var host = global.ZW.host;
    var headers = await headersFor(path);
    var response = await host.request({ url: BASE + path, method: 'GET', headers: headers });
    var payload = null;
    if (response.text) {
      try {
        payload = JSON.parse(response.text);
      } catch (error) {
        payload = null;
      }
    }
    if (response.status === 200 && payload) {
      return payload;
    }
    var apiError = new ApiError(describe(response.status, payload), response.status, payload);
    if (apiError.status === 403 || apiError.status === 401) {
      // Cookies may have rotated in the browser; re-read once and retry.
      await refreshSession();
      var retryHeaders = await headersFor(path);
      var retry = await host.request({ url: BASE + path, method: 'GET', headers: retryHeaders });
      if (retry.status === 200 && retry.text) {
        try {
          return JSON.parse(retry.text);
        } catch (error) {
          throw new ApiError('响应格式异常', retry.status, null);
        }
      }
    }
    throw apiError;
  }

  function withQuery(path, include) {
    return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'include=' + encodeURIComponent(include);
  }

  async function rawWithInclude(path, include) {
    try {
      return await raw(withQuery(path, include));
    } catch (error) {
      if (error.status === 400 && include) {
        return await raw(path);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- endpoints

  function hot() {
    return appRaw('/topstory/hot-list', { limit: 50 });
  }

  async function recommend(page) {
    var number = Math.max(1, page || 1);
    if (session.signedIn) {
      return raw('/api/v3/feed/topstory/recommend?desktop=true&page_number=' + number +
        '&limit=10&action=down&ad_interval=-1');
    }
    var query = {
      action: 'down',
      ad_interval: -10,
      after_id: 0,
      end_offset: 0,
      page_number: number,
      start_type: number === 1 ? 'cold' : 'warm',
      refresh_scene: 0,
      device: 'pad',
      short_container_setting_value: 0,
      include_guide_relation: false,
      is_feed_first_request: number === 1 ? 1 : 0
    };
    try {
      var res = await appRaw('/topstory/recommend', query);
      if (res && ((res.data && res.data.length) || (res.dataV1 && res.dataV1.length))) {
        return res;
      }
    } catch (error) {
      // Fall back to the browser guest explore feed when the app endpoint rejects.
    }
    return raw('/api/v3/explore/guest/feeds?limit=15&ws_qiangzhisafe=0');
  }

  function following() {
    if (session.signedIn) {
      return raw('/api/v3/moments?limit=10&desktop=true');
    }
    return appRaw('/moments_v3', {
      feed_type: 'timeline',
      action: 'down',
      page_num: 1,
      offset: 0,
      session_id: ''
    });
  }

  function search(query, offset) {
    return raw('/api/v4/search_v3?t=general&q=' + encodeURIComponent(query) + '&correction=1&offset=' +
      (offset || 0) + '&limit=20&search_source=Normal');
  }

  function question(id) {
    if (session.signedIn) {
      return rawWithInclude('/api/v4/questions/' + encodeURIComponent(id), QUESTION_INCLUDE);
    }
    return appRawWithInclude('/questions/' + encodeURIComponent(id), {}, 'read_count,query_info,voteup_count,voting,can_vote');
  }

  function questionAnswers(id, offset, sortBy) {
    if (session.signedIn) {
      var params = 'limit=10&offset=' + (offset || 0) + '&sort_by=' + (sortBy || 'default') +
        '&platform=desktop&include=' + encodeURIComponent(ANSWER_LIST_INCLUDE);
      return raw('/api/v4/questions/' + encodeURIComponent(id) + '/answers?' + params);
    }
    var order = sortBy === 'created' ? 'updated' : 'default';
    return appRawWithInclude('/questions/' + encodeURIComponent(id) + '/feeds', {
      order: order,
      limit: 10,
      offset: offset || 0
    }, 'big_card_summary,media_detail,reaction_instruction,is_author,is_thanked,voting,is_favorited,favlists_count,reaction,label_info,content_text_length,reactions');
  }

  async function commentPage(kind, id, offset) {
    id = String(id);
    if (!/^\d+$/.test(id)) throw new Error('评论目标无效');
    var root = kind === 'answer';
    var path = '/api/v4/comment_v5/' + (root ? 'answers/' + id + '/root_comment' : 'comment/' + id + '/child_comment');
    var payload = await raw(path + '?' + new URLSearchParams({
      order_by: root ? 'score' : 'ts', limit: '20', offset: offset || ''
    }));
    if (!Array.isArray(payload.data)) throw new Error('知乎返回了无法读取的评论数据');
    var next = null;
    if (payload.paging && !payload.paging.is_end && payload.paging.next) {
      try {
        var url = new URL(payload.paging.next, BASE);
        var cursor = url.searchParams.get('offset');
        if (url.origin === BASE && url.pathname === path && cursor && cursor !== offset) next = cursor;
      } catch (error) { /* Invalid pagination link. */ }
    }
    return { items: payload.data, next: next };
  }

  function answer(id) {
    return raw('/api/v4/answers/' + encodeURIComponent(id) + '?include=' + encodeURIComponent(ANSWER_INCLUDE));
  }

  function article(id) {
    return raw('/api/v4/articles/' + encodeURIComponent(id) + '?include=content,title,excerpt,voteup_count,comment_count,author,created_time,updated_time,image_url');
  }

  function me() {
    return raw('/api/v4/me?include=is_realname,name,avatar_url,url_token,headline');
  }

  async function signIn() {
    var result = await global.ZW.host.login();
    if (result && result.signedIn) {
      await refreshSession();
      if (session.signedIn) {
        try {
          var profile = await me();
          session.name = profile.name || '';
          session.avatar = profile.avatar_url || '';
        } catch (error) {
          // Profile is a nicety, the session is what matters.
        }
      }
    }
    return session;
  }

  async function signOut() {
    await global.ZW.host.clearCookies();
    session.cookie = '';
    session.dc0 = '';
    session.signedIn = false;
    session.name = '';
    session.avatar = '';
    return session;
  }

  global.ZW = global.ZW || {};
  global.ZW.api = {
    BASE: BASE,
    ApiError: ApiError,
    session: session,
    refreshSession: refreshSession,
    cookieValue: cookieValue,
    hot: hot,
    recommend: recommend,
    following: following,
    search: search,
    question: question,
    questionAnswers: questionAnswers,
    answer: answer,
    commentPage: commentPage,
    article: article,
    me: me,
    signIn: signIn,
    signOut: signOut
  };
})(window);

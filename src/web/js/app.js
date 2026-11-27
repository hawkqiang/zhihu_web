/*
 * zhihu_web - application shell: routing, data loading, views.
 * Vanilla JavaScript on purpose: no bundler, no framework, no node_modules.
 */
(function (global) {
  'use strict';

  var host = global.ZW.host;
  var api = global.ZW.api;
  var store = global.ZW.store;
  var R = global.ZW.render;

  var view = document.getElementById('view');
  var crumb = document.getElementById('crumb');
  var back = document.getElementById('back');
  var toastEl = document.getElementById('toast');
  var accountName = document.getElementById('accountName');
  var accountHint = document.getElementById('accountHint');
  var avatar = document.getElementById('avatar');

  var CACHE_TTL = 120000;
  var cache = new Map();
  var currentRoute = '';
  var requestToken = 0;

  // --------------------------------------------------------------- utilities

  function el(html) {
    var template = document.createElement('template');
    template.innerHTML = String(html).trim();
    return template.content.firstElementChild;
  }

  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'toast show' + (kind ? ' ' + kind : '');
    global.clearTimeout(toast._timer);
    toast._timer = global.setTimeout(function () {
      toastEl.className = 'toast';
    }, kind === 'error' ? 5200 : 2600);
  }

  function setCrumb(text) {
    crumb.textContent = text;
    host.setTitle(text).catch(function () {});
  }

  function setView(node) {
    view.innerHTML = '';
    view.appendChild(node);
    view.scrollTop = 0;
    R.decorate(view);
  }

  function skeleton(rows) {
    var wrapper = el('<div class="skeleton-list"></div>');
    for (var i = 0; i < (rows || 6); i += 1) {
      wrapper.appendChild(el(
        '<div class="skeleton"><div class="sk-line w60"></div><div class="sk-line w90"></div>' +
        '<div class="sk-line w80"></div><div class="sk-line w30"></div></div>'
      ));
    }
    return wrapper;
  }

  function stateBlock(options) {
    var node = el(
      '<div class="state">' +
      '<div class="state-icon">' + (options.icon || '·') + '</div>' +
      '<p class="state-title">' + R.escapeHtml(options.title || '') + '</p>' +
      (options.detail ? '<p class="state-detail">' + R.escapeHtml(options.detail) + '</p>' : '') +
      '<div class="state-actions"></div>' +
      '</div>'
    );
    var actions = node.querySelector('.state-actions');
    (options.actions || []).forEach(function (action) {
      var button = el('<button type="button" class="btn' + (action.primary ? ' primary' : '') + '">' + R.escapeHtml(action.label) + '</button>');
      button.addEventListener('click', action.run);
      actions.appendChild(button);
    });
    return node;
  }

  function errorState(error, retry, targetUrl) {
    var message = error && error.message ? error.message : '加载失败';
    var actions = [{ label: '重试', run: retry, primary: true }];
    if (/登录|401|403/.test(message)) {
      actions.push({
        label: '登录知乎',
        run: function () { signIn(); }
      });
    }
    actions.push({
      label: targetUrl ? '在内置浏览器中打开此页' : '在内置浏览器中打开知乎',
      run: function () { host.openPage(targetUrl || 'https://www.zhihu.com/').catch(function () {}); }
    });
    return stateBlock({
      icon: '!',
      title: message,
      detail: '如果接口被知乎风控或要求登录，可以先点击“登录知乎”或“在内置浏览器中打开此页”继续阅读。',
      actions: actions
    });
  }

  async function cached(key, loader, force) {
    var hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL) {
      return hit.data;
    }
    var data = await loader();
    cache.set(key, { at: Date.now(), data: data });
    return data;
  }

  // ---------------------------------------------------------------- theming

  var media = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function isDark() {
    var theme = store.settings().theme;
    if (theme === 'dark') {
      return true;
    }
    if (theme === 'light') {
      return false;
    }
    return !!(media && media.matches);
  }

  function applyAppearance() {
    document.documentElement.setAttribute('data-theme', isDark() ? 'dark' : 'light');
    document.documentElement.style.setProperty('--reader-size', store.settings().fontSize + 'px');
    if (media && media.addEventListener) {
      media.addEventListener('change', function () {
        if (store.settings().theme === 'auto') {
          applyAppearance();
        }
      });
    }
  }

  async function signIn() {
    try {
      var session = await api.signIn();
      renderAccount();
      if (session.signedIn) {
        toast('登录成功：' + (session.name || '已登录'));
        cache.clear();
        render();
      } else {
        toast('未检测到登录状态', 'error');
      }
    } catch (error) {
      toast(error.message || '登录失败', 'error');
    }
  }

  function renderAccount() {
    var session = api.session;
    if (session.signedIn) {
      accountName.textContent = session.name || '已登录';
      accountHint.textContent = '点击退出登录';
      avatar.textContent = (session.name || '知').slice(0, 1);
      avatar.classList.add('signed');
    } else {
      accountName.textContent = '未登录';
      accountHint.textContent = '点击登录知乎';
      avatar.textContent = '访';
      avatar.classList.remove('signed');
    }
  }

  // ------------------------------------------------------------------- views

  function cardList(items, options) {
    var opts = options || {};
    var list = el('<div class="list"></div>');
    if (!items.length) {
      list.appendChild(stateBlock({ icon: '∅', title: '这里还没有内容' }));
      return list;
    }
    items.forEach(function (item, index) {
      var card = R.card(item);
      if (opts.ranked) {
        var rank = el('<span class="rank">' + (index + 1) + '</span>');
        card.querySelector('.card-head').prepend(rank);
        if (index < 3) {
          rank.classList.add('top');
        }
      }
      list.appendChild(card);
    });
    if (opts.footer) {
      list.appendChild(opts.footer);
    }
    return list;
  }

  function feedFooter(label, onMore) {
    var footer = el('<div class="list-footer"><button type="button" class="btn">' + R.escapeHtml(label) + '</button></div>');
    footer.querySelector('button').addEventListener('click', onMore);
    return footer;
  }

  async function guard(fn, targetUrl) {
    var token = ++requestToken;
    try {
      await fn(token);
    } catch (error) {
      if (token !== requestToken) {
        return;
      }
      setView(errorState(error, function () { render(true); }, targetUrl));
    }
  }

  function stashFeedTargets(rows) {
    (rows || []).forEach(function (row) {
      var target = row && row.target;
      if (!target || !target.id) {
        return;
      }
      if (target.type === 'answer' && target.content) {
        cache.set('a:' + target.id, { at: Date.now(), data: target });
      } else if (target.type === 'article' && target.content) {
        cache.set('art:' + target.id, { at: Date.now(), data: target });
      }
    });
  }

  var hotQuestions = new Map();

  function viewHot() {
    setCrumb('热榜');
    setView(skeleton(7));
    return guard(async function (token) {
      var payload = await cached('hot', function () { return api.hot(); });
      if (token !== requestToken) {
        return;
      }
      var items = R.normalize(payload.data || [], 'hot');
      hotQuestions.clear();
      items.forEach(function (item) {
        if (item.id) hotQuestions.set(item.id, item);
      });
      setView(cardList(items, { ranked: true }));
      host.metric('hot-loaded', Math.round(performance.now())).catch(function () {});
    }, 'https://www.zhihu.com/hot');
  }

  var recommendPage = 1;

  function viewRecommend() {
    setCrumb('推荐');
    setView(skeleton(6));
    return guard(async function (token) {
      var payload = await cached('recommend:' + recommendPage, function () { return api.recommend(recommendPage); });
      if (token !== requestToken) {
        return;
      }
      var rows = (payload.dataV1 && payload.dataV1.length) ? payload.dataV1 : (payload.data || []);
      stashFeedTargets(rows);
      var items = R.normalize(rows, 'feed');
      setView(cardList(items, {
        footer: feedFooter('换一批', function () {
          recommendPage += 1;
          cache.delete('recommend:' + recommendPage);
          viewRecommend();
        })
      }));
    }, 'https://www.zhihu.com/');
  }

  function viewFollowing() {
    setCrumb('关注');
    setView(skeleton(5));
    return guard(async function (token) {
      if (!api.session.signedIn) {
        setView(stateBlock({
          icon: '·',
          title: '关注动态需要登录',
          detail: '登录后这里会显示你关注的人最近发布的回答和文章。',
          actions: [
            { label: '登录知乎', run: signIn, primary: true },
            { label: '先看看热榜', run: function () { navigate('#/hot'); } }
          ]
        }));
        return;
      }
      var payload = await cached('following', function () { return api.following(); });
      if (token !== requestToken) {
        return;
      }
      var rows = (payload.dataV1 && payload.dataV1.length) ? payload.dataV1 : (payload.data || []);
      stashFeedTargets(rows);
      setView(cardList(R.normalize(rows, 'feed')));
    }, 'https://www.zhihu.com/follow');
  }

  function viewSearch(query) {
    setCrumb('搜索：' + query);
    setView(skeleton(6));
    return guard(async function (token) {
      var payload = await cached('search:' + query, function () { return api.search(query, 0); });
      if (token !== requestToken) {
        return;
      }
      var items = R.normalize(payload.data || [], 'search');
      var node = el('<div></div>');
      node.appendChild(el('<p class="search-summary">找到 ' + items.length + ' 条与“' + R.escapeHtml(query) + '”相关的内容</p>'));
      node.appendChild(cardList(items, {
        footer: feedFooter('在知乎网页中搜索', function () {
          host.openPage('https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(query)).catch(function () {});
        })
      }));
      setView(node);
    }, 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(query));
  }

  function commentThread(kind, id, count, rootAnswerId) {
    var num = count || 0;
    var targetAnswerId = rootAnswerId || id;
    var openLabel = (kind === 'answer' ? '展开评论' : '展开回复') + (num ? '（' + R.compactNumber(num) + '）' : '');
    var closeLabel = (kind === 'answer' ? '收起评论' : '收起回复') + (num ? '（' + R.compactNumber(num) + '）' : '');
    var section = el('<section class="comment-thread"></section>');
    var toggle = el('<button class="btn comment-toggle-btn" type="button" aria-expanded="false"></button>');
    var panel = el('<div hidden></div>');
    var inputBox = el(
      '<div class="comment-input-box">' +
      '<input type="text" class="comment-input" placeholder="' + (kind === 'answer' ? '写下你的评论...' : '写下你的回复...') + '">' +
      '<button type="button" class="btn primary send-btn">发送</button>' +
      '</div>'
    );
    var list = el('<div></div>');
    var status = el('<p class="card-meta" role="status" style="margin:6px 0;"></p>');
    var more = el('<button class="btn" type="button" hidden style="margin-top:8px;">加载更多</button>');
    var loaded = false;
    var loading = false;
    var cursor = '';
    var seen = new Set();
    var visited = new Set();
    toggle.textContent = openLabel;
    panel.append(inputBox, list, status, more);
    section.append(toggle, panel);

    var inputEl = inputBox.querySelector('.comment-input');
    var sendBtn = inputBox.querySelector('.send-btn');
    sendBtn.addEventListener('click', async function () {
      var txt = (inputEl.value || '').trim();
      if (!txt) {
        toast('评论内容不能为空', 'error');
        return;
      }
      if (!api.session.signedIn) {
        await signIn();
        if (!api.session.signedIn) return;
      }
      sendBtn.disabled = true;
      sendBtn.textContent = '发送中...';
      try {
        var replyId = kind === 'reply' ? id : undefined;
        await api.createComment('answers', targetAnswerId, txt, replyId);
        inputEl.value = '';
        toast(kind === 'answer' ? '评论发表成功！' : '回复发表成功！');
        var myName = (api.session && api.session.name) || '我';
        var newRow = el('<article class="comment-row"></article>');
        var myHeader = el('<div class="comment-header"><span class="comment-author">' + R.escapeHtml(myName) + '</span><span class="comment-meta">刚刚</span></div>');
        var myBody = el('<div class="content"><p>' + R.escapeHtml(txt) + '</p></div>');
        newRow.append(myHeader, myBody);
        list.prepend(newRow);
        if (status.textContent === '暂无评论内容') status.textContent = '';
      } catch (err) {
        toast(err.message || '发布失败', 'error');
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '发送';
      }
    });

    async function load() {
      if (loading || cursor === null) return;
      loading = true;
      more.hidden = true;
      status.textContent = '正在加载评论…';
      try {
        var page = await api.commentPage(kind, id, cursor);
        (page.items || []).forEach(function (item) {
          if (!item || item.is_delete) return;
          var key = String(item.id || '');
          if (key && seen.has(key)) return;
          if (key) seen.add(key);
          var row = el('<article class="comment-row"></article>');
          var header = el('<div class="comment-header"></div>');
          var author = item.author && (item.author.member || item.author);
          var authorName = (author && author.name) || '知乎用户';
          var by = el('<span class="comment-author">' + R.escapeHtml(authorName) + '</span>');
          var actionsDiv = el('<div class="comment-actions"></div>');
          if (item.created_time) {
            actionsDiv.appendChild(el('<span class="comment-meta">' + R.timeAgo(item.created_time) + '</span>'));
          }
          var replyActionBtn = el('<button type="button" class="comment-reply-btn">回复</button>');
          actionsDiv.appendChild(replyActionBtn);
          header.append(by, actionsDiv);

          var body = el('<div class="content"></div>');
          body.appendChild(R.sanitize(item.content, { images: store.settings().images }));

          var subReplyForm = el(
            '<div class="comment-reply-form" hidden>' +
            '<input type="text" class="comment-input" placeholder="回复 @' + R.escapeHtml(authorName) + '...">' +
            '<button type="button" class="btn primary">发送</button>' +
            '</div>'
          );

          replyActionBtn.addEventListener('click', function () {
            subReplyForm.hidden = !subReplyForm.hidden;
            if (!subReplyForm.hidden) {
              var subInput = subReplyForm.querySelector('input');
              if (subInput) subInput.focus();
            }
          });

          var subSendBtn = subReplyForm.querySelector('button');
          var subInputEl = subReplyForm.querySelector('input');
          subSendBtn.addEventListener('click', async function () {
            var subTxt = (subInputEl.value || '').trim();
            if (!subTxt) {
              toast('回复内容不能为空', 'error');
              return;
            }
            if (!api.session.signedIn) {
              await signIn();
              if (!api.session.signedIn) return;
            }
            subSendBtn.disabled = true;
            subSendBtn.textContent = '...';
            try {
              await api.createComment('answers', targetAnswerId, subTxt, key);
              subInputEl.value = '';
              subReplyForm.hidden = true;
              toast('回复发表成功！');
              var myName = (api.session && api.session.name) || '我';
              var subRow = el('<article class="comment-row" style="margin-left: 12px; border-left: 2px solid var(--border); padding-left: 10px;"></article>');
              var subHeader = el('<div class="comment-header"><span class="comment-author">' + R.escapeHtml(myName) + '</span><span class="comment-meta">刚刚</span></div>');
              var subBody = el('<div class="content"><p>' + R.escapeHtml(subTxt) + '</p></div>');
              subRow.append(subHeader, subBody);
              row.appendChild(subRow);
            } catch (err) {
              toast(err.message || '回复失败', 'error');
            } finally {
              subSendBtn.disabled = false;
              subSendBtn.textContent = '发送';
            }
          });

          row.append(header, body, subReplyForm);
          R.decorate(body);

          var subCount = item.child_comment_count || (item.child_comments ? item.child_comments.length : 0);
          if (kind === 'answer' && /^\d+$/.test(key) && subCount > 0) {
            row.appendChild(commentThread('reply', key, subCount, targetAnswerId));
          }
          list.appendChild(row);
        });
        loaded = true;
        visited.add(cursor);
        cursor = page.next && !visited.has(page.next) ? page.next : null;
        status.textContent = list.childElementCount ? '' : '暂无评论内容';
        more.textContent = '加载更多评论';
        more.hidden = cursor === null;
      } catch (error) {
        status.textContent = error.status === 401 || error.needLogin ? '知乎要求登录后查看评论。' :
          error.status === 403 ? '知乎拒绝了评论请求（403）。' :
          '评论加载失败：' + (error.message || '网络连接异常');
        more.textContent = '重试';
        more.hidden = false;
      } finally {
        loading = false;
      }
    }
    toggle.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      toggle.textContent = panel.hidden ? openLabel : closeLabel;
      if (!panel.hidden && !loaded) load();
    });
    more.addEventListener('click', load);
    return section;
  }

  function answerElement(answer, options) {
    var opts = options || {};
    var author = answer.author || {};
    var node = el('<div class="answer"></div>');
    var head = el(
      '<div class="answer-head">' +
      (author.avatar_url ? '<img class="answer-avatar" src="' + R.escapeHtml(author.avatar_url) + '" alt="" referrerpolicy="no-referrer" loading="lazy">' : '') +
      '<div class="answer-who"><b>' + R.escapeHtml(author.name || '匿名用户') + '</b>' +
      '<small>' + R.escapeHtml(author.headline || '') + '</small></div>' +
      '<div class="answer-stats">' +
      (answer.voteup_count ? '赞同 ' + R.compactNumber(answer.voteup_count) : '') +
      (answer.comment_count ? ' · ' + R.compactNumber(answer.comment_count) + ' 评论' : '') +
      '</div></div>'
    );
    var body = el('<div class="answer-body content"></div>');
    var collapsed = !opts.full && answer.is_collapsed;
    body.appendChild(R.sanitize(collapsed ? (answer.excerpt || answer.content) : (answer.content || answer.excerpt), {
      images: store.settings().images
    }));
    node.appendChild(head);
    node.appendChild(body);

    var footer = el('<div class="answer-foot"></div>');
    if (collapsed && answer.id) {
      var more = el('<a class="btn" href="#/a/' + R.escapeHtml(String(answer.id)) + '">阅读全文</a>');
      footer.appendChild(more);
    }
    var answerId = String(answer.id || '');
    if (opts.questionTitle && answer.question) {
      footer.appendChild(el('<a class="chip" href="#/q/' + R.escapeHtml(String(answer.question.id)) + '">在问题中查看</a>'));
    }
    if (footer.childElementCount) {
      node.appendChild(footer);
    }
    if (/^\d+$/.test(answerId)) {
      var thread = commentThread('answer', answerId, answer.comment_count);
      node.appendChild(thread);
      if (opts.openComments) {
        var btn = thread.querySelector('.comment-toggle-btn');
        if (btn) btn.click();
      }
    }
    return node;
  }

  async function viewQuestion(id) {
    setCrumb('问题');
    setView(skeleton(5));
    return guard(async function (token) {
      var preview = hotQuestions.get(id);
      var officialUrl = 'https://www.zhihu.com/question/' + encodeURIComponent(id);
      var info = null;
      var answers = null;
      var answerError = null;
      await Promise.all([
        api.session.signedIn ? cached('q:' + id, function () { return api.question(id); }).then(function (data) { info = data; }, function () {}) : null,
        cached('qa:' + id, function () { return api.questionAnswers(id, 0, 'default'); }).then(function (data) { answers = data; }, function (error) { answerError = error; })
      ]);
      info = info || { title: preview ? preview.title : '知乎问题', detail: preview ? preview.excerpt : '' };
      if (token !== requestToken) {
        return;
      }

      var node = el('<div class="detail"></div>');
      node.appendChild(el(
        '<header class="detail-head">' +
        '<h2>' + R.escapeHtml(info.title || '') + '</h2>' +
        '<div class="detail-meta">' +
        (info.answer_count ? '<span>' + R.compactNumber(info.answer_count) + ' 个回答</span>' : '') +
        (info.follower_count ? '<span>' + R.compactNumber(info.follower_count) + ' 人关注</span>' : '') +
        (info.visit_count ? '<span>' + R.compactNumber(info.visit_count) + ' 次浏览</span>' : '') +
        '</div></header>'
      ));

      var detail = R.textOf(info.detail);
      if (detail) {
        var body = el('<div class="detail-body content collapsed"></div>');
        body.appendChild(R.sanitize(info.detail, { images: store.settings().images }));
        var toggle = el('<button type="button" class="link-btn">展开问题描述</button>');
        toggle.addEventListener('click', function () {
          var isCollapsed = body.classList.toggle('collapsed');
          toggle.textContent = isCollapsed ? '展开问题描述' : '收起问题描述';
        });
        node.appendChild(body);
        node.appendChild(toggle);
      }

      var writeBar = el(
        '<div class="detail-actions" style="margin: 10px 0 14px;">' +
        '<button type="button" class="btn primary" id="openWriteBtn">✏️ 写回答</button>' +
        '</div>'
      );
      var writeSection = el(
        '<div class="write-answer-section" hidden>' +
        '<h4 style="margin: 0 0 10px; font-size: 15px; font-weight: 600;">撰写我的回答</h4>' +
        '<textarea placeholder="写下你的专业回答，支持换行自动分段..."></textarea>' +
        '<div class="write-answer-foot">' +
        '<span class="write-answer-meta" id="wordCountLabel">0 字</span>' +
        '<div class="write-answer-btns">' +
        '<button type="button" class="btn" id="cancelWriteBtn">取消</button>' +
        '<button type="button" class="btn primary" id="publishAnswerBtn">发布回答</button>' +
        '</div>' +
        '</div>' +
        '</div>'
      );

      var textareaEl = writeSection.querySelector('textarea');
      var wordCountLabel = writeSection.querySelector('#wordCountLabel');
      var cancelWriteBtn = writeSection.querySelector('#cancelWriteBtn');
      var publishAnswerBtn = writeSection.querySelector('#publishAnswerBtn');
      var openWriteBtn = writeBar.querySelector('#openWriteBtn');

      openWriteBtn.addEventListener('click', async function () {
        if (!api.session.signedIn) {
          await signIn();
          if (!api.session.signedIn) return;
        }
        writeSection.hidden = !writeSection.hidden;
        if (!writeSection.hidden) textareaEl.focus();
      });

      textareaEl.addEventListener('input', function () {
        wordCountLabel.textContent = textareaEl.value.trim().length + ' 字';
      });

      cancelWriteBtn.addEventListener('click', function () {
        writeSection.hidden = true;
      });

      publishAnswerBtn.addEventListener('click', async function () {
        var content = textareaEl.value.trim();
        if (!content) {
          toast('回答内容不能为空', 'error');
          return;
        }
        if (!api.session.signedIn) {
          await signIn();
          if (!api.session.signedIn) return;
        }
        publishAnswerBtn.disabled = true;
        publishAnswerBtn.textContent = '发布中...';
        try {
          await api.createAnswer(id, content);
          toast('回答发布成功！');
          textareaEl.value = '';
          wordCountLabel.textContent = '0 字';
          writeSection.hidden = true;
          cache.delete('qa:' + id);
          render();
        } catch (err) {
          toast(err.message || '发布回答失败', 'error');
        } finally {
          publishAnswerBtn.disabled = false;
          publishAnswerBtn.textContent = '发布回答';
        }
      });

      node.appendChild(writeBar);
      node.appendChild(writeSection);

      var list = el('<div class="answers"></div>');
      var offset = 0;
      function appendAnswers(payload) {
        (payload.data || []).forEach(function (entry) {
          var answer = entry && (entry.target || entry.answer || entry);
          if (!answer || !answer.id || (answer.type && answer.type !== 'answer') || !(answer.content || answer.excerpt)) return;
          list.appendChild(answerElement(answer, {
            full: store.settings().expandAnswers,
            openComments: offset === 0 && list.childElementCount === 0,
            questionTitle: false
          }));
        });
        offset += (payload.data || []).length;
      }
      if (answers) appendAnswers(answers);
      var fromFeed = false;
      if (!list.childElementCount) {
        var previews = [];
        cache.forEach(function (entry, key) {
          var answer = entry.data;
          if (key.indexOf('a:') === 0 && Date.now() - entry.at < CACHE_TTL &&
              answer && answer.question && String(answer.question.id) === id) previews.push(answer);
        });
        if (previews.length) {
          offset = 0;
          appendAnswers({ data: previews });
          fromFeed = list.childElementCount > 0;
          if (fromFeed) node.appendChild(el('<p class="card-meta">以下是推荐流已取得的回答，不是完整回答列表。</p>'));
        }
      }

      var moreButton = el('<div class="list-footer"><button type="button" class="btn">加载更多回答</button></div>');
      moreButton.querySelector('button').addEventListener('click', async function () {
        var button = moreButton.querySelector('button');
        button.disabled = true;
        button.textContent = '加载中…';
        try {
          var page = await api.questionAnswers(id, offset, 'default');
          appendAnswers(page);
          R.decorate(list);
          button.disabled = false;
          button.textContent = '加载更多回答';
          if (!page.data || !page.data.length) {
            moreButton.remove();
            toast('没有更多回答了');
          }
        } catch (error) {
          button.disabled = false;
          button.textContent = '加载更多回答';
          toast(error.message, 'error');
        }
      });
      node.appendChild(list);
      if (!fromFeed && offset && answers && !(answers.paging && answers.paging.is_end)) node.appendChild(moreButton);
      if (!list.childElementCount) {
        var actions = [];
        var isLoginRequired = !api.session.signedIn || (answerError && (answerError.needLogin || answerError.status === 401));
        if (isLoginRequired) {
          actions.push({
            label: '登录知乎账号',
            primary: true,
            run: async function () {
              await signIn();
              if (api.session.signedIn) {
                cache.delete('qa:' + id);
                cache.delete('q:' + id);
                render(true);
              }
            }
          });
        } else {
          actions.push({
            label: '在应用内重试',
            primary: true,
            run: function () {
              cache.delete('qa:' + id);
              render();
            }
          });
        }
        actions.push({
          label: '在内置浏览器中查看原网页',
          run: function () {
            host.openPage(officialUrl).catch(function (error) { toast(error.message, 'error'); });
          }
        });

        node.appendChild(stateBlock({
          title: isLoginRequired ? '登录后即可阅读回答与展开评论' : (answerError ? '回答加载失败' : '暂无可显示的回答'),
          detail: isLoginRequired ?
            '知乎服务器对游客模式限制了该问题的回答和评论接口。登录后即可直接在应用内阅读完整回答，并就地依次展开各级评论。' :
            (answerError ? (answerError.message || '请检查网络后重试。') : '知乎没有返回可显示的回答。'),
          actions: actions
        }));
      }
      setView(node);

      store.visit({ route: 'q:' + id, title: info.title || '', kind: '问题' });
    }, 'https://www.zhihu.com/question/' + encodeURIComponent(id));
  }

  async function viewAnswer(id) {
    setCrumb('回答');
    setView(skeleton(4));
    return guard(async function (token) {
      var answer = await cached('a:' + id, function () { return api.answer(id); });
      if (token !== requestToken) {
        return;
      }
      var node = el('<div class="detail"></div>');
      var questionTitle = answer.question ? answer.question.title : '';
      if (questionTitle) {
        node.appendChild(el('<h2 class="detail-question"><a href="#/q/' + R.escapeHtml(String(answer.question.id)) + '">' +
          R.escapeHtml(questionTitle) + '</a></h2>'));
      } else {
        node.appendChild(el('<h2 class="detail-question">回答</h2>'));
      }
      var answerNode = answerElement(answer, { full: true, questionTitle: false });
      node.appendChild(answerNode);
      var meta = el('<div class="detail-meta"></div>');
      if (answer.created_time) {
        meta.appendChild(el('<span>' + R.timeAgo(answer.created_time) + '</span>'));
      }
      if (answer.voteup_count) {
        meta.appendChild(el('<span>赞同 ' + R.compactNumber(answer.voteup_count) + '</span>'));
      }
      if (answer.comment_count) {
        meta.appendChild(el('<span>' + R.compactNumber(answer.comment_count) + ' 评论</span>'));
      }
      var manual = el('<div class="detail-actions"></div>');
      var openWeb = el('<button type="button" class="btn">在知乎网页中打开</button>');
      openWeb.addEventListener('click', function () {
        var url = answer.question && answer.question.id
          ? 'https://www.zhihu.com/question/' + answer.question.id + '/answer/' + id
          : 'https://www.zhihu.com/';
        host.openPage(url).catch(function () {});
      });
      manual.appendChild(openWeb);
      node.appendChild(meta);
      node.appendChild(manual);
      setView(node);
      store.visit({
        route: 'a:' + id,
        title: questionTitle || '回答 ' + id,
        kind: '回答'
      });
    }, 'https://www.zhihu.com/answer/' + encodeURIComponent(id));
  }

  async function viewArticle(id) {
    setCrumb('文章');
    setView(skeleton(4));
    return guard(async function (token) {
      var article = await cached('art:' + id, function () { return api.article(id); });
      if (token !== requestToken) {
        return;
      }
      var node = el('<div class="detail"></div>');
      node.appendChild(el('<h2>' + R.escapeHtml(article.title || '文章') + '</h2>'));
      var author = article.author || {};
      node.appendChild(el('<div class="detail-meta">' +
        (author.name ? '<span>' + R.escapeHtml(author.name) + '</span>' : '') +
        (article.voteup_count ? '<span>赞同 ' + R.compactNumber(article.voteup_count) + '</span>' : '') +
        (article.created_time ? '<span>' + R.timeAgo(article.created_time) + '</span>' : '') +
        '</div>'));
      var body = el('<div class="detail-body content"></div>');
      body.appendChild(R.sanitize(article.content || article.excerpt, { images: store.settings().images }));
      node.appendChild(body);
      setView(node);
      store.visit({ route: 'art:' + id, title: article.title || '文章', kind: '文章' });
    }, 'https://zhuanlan.zhihu.com/p/' + encodeURIComponent(id));
  }

  function viewHistory() {
    setCrumb('历史');
    var items = store.history();
    var node = el('<div></div>');
    if (!items.length) {
      node.appendChild(stateBlock({ icon: '·', title: '还没有阅读记录', detail: '打开过的回答和文章会记录在这里，只保存在本机。' }));
      setView(node);
      return;
    }
    var list = el('<div class="list"></div>');
    items.forEach(function (item) {
      var row = el('<article class="card history-row" data-route="#/' + (item.route.indexOf('a:') === 0 ? 'a/' : item.route.indexOf('art:') === 0 ? 'art/' : 'q/') +
        R.escapeHtml(item.route.split(':')[1] || '') + '">' +
        '<span class="badge">' + R.escapeHtml(item.kind) + '</span>' +
        '<h3 class="card-title">' + R.escapeHtml(item.title) + '</h3>' +
        '<div class="card-meta"><span>' + new Date(item.at).toLocaleString('zh-CN') + '</span></div></article>');
      list.appendChild(row);
    });
    node.appendChild(list);
    var clear = el('<div class="list-footer"><button type="button" class="btn">清空阅读记录</button></div>');
    clear.querySelector('button').addEventListener('click', function () {
      store.clearHistory();
      viewHistory();
      toast('已清空');
    });
    node.appendChild(clear);
    setView(node);
  }

  async function viewSettings() {
    setCrumb('设置');
    var settings = store.settings();
    var info = await host.info().catch(function () { return {}; });
    var node = el(
      '<div class="settings">' +
      '<section class="panel"><h3>外观</h3>' +
      '<div class="row"><label>主题</label><div class="segmented" id="themeSeg">' +
      '<button type="button" data-value="auto">跟随系统</button>' +
      '<button type="button" data-value="light">浅色</button>' +
      '<button type="button" data-value="dark">深色</button>' +
      '</div></div>' +
      '<div class="row"><label>正文字号</label><input type="range" id="fontRange" min="15" max="21" step="1" value="' + settings.fontSize + '">' +
      '<span class="value" id="fontValue">' + settings.fontSize + 'px</span></div>' +
      '<div class="row"><label>正文图片</label><label class="switch"><input type="checkbox" id="imagesToggle"' + (settings.images ? ' checked' : '') + '><span></span></label></div>' +
      '<div class="row"><label>问题页直接展开回答</label><label class="switch"><input type="checkbox" id="expandToggle"' + (settings.expandAnswers ? ' checked' : '') + '><span></span></label></div>' +
      '</section>' +
      '<section class="panel"><h3>账号</h3>' +
      '<div class="row"><label>登录状态</label><span class="value" id="loginState">' + (api.session.signedIn ? R.escapeHtml(api.session.name || '已登录') : '未登录') + '</span></div>' +
      '<div class="row actions"><button type="button" class="btn" id="loginBtn">' + (api.session.signedIn ? '退出登录' : '登录知乎') + '</button>' +
      '<button type="button" class="btn" id="openZhihu">在内置浏览器中打开知乎</button></div>' +
      '</section>' +
      '<section class="panel"><h3>本地数据</h3>' +
      '<div class="row"><label>数据目录</label><span class="value path">' + R.escapeHtml(info.dataDir || '—') + '</span></div>' +
      '<div class="row actions"><button type="button" class="btn" id="openData">打开数据目录</button>' +
      '<button type="button" class="btn" id="clearHistory">清空阅读记录</button></div>' +
      '</section>' +
      '<section class="panel"><h3>关于</h3>' +
      '<p class="about">zhihu_web ' + R.escapeHtml(info.version || '') + ' · 宿主 ' + R.escapeHtml(info.host || '') + '</p>' +
      '<p class="about">WebView2 运行时：' + R.escapeHtml(info.runtime || '未知') + '</p>' +
      '<p class="about">轻量第三方知乎阅读器，界面与逻辑基于开源项目 <b>知乎--</b>（huamurui/zhihu-minus-minus）的接口用法重写，GPL-3.0。</p>' +
      '<p class="about">不是知乎官方产品，与知乎无隶属关系。内容版权归原作者所有。</p>' +
      '</section>' +
      '</div>'
    );

    node.querySelectorAll('#themeSeg button').forEach(function (button) {
      if (button.getAttribute('data-value') === settings.theme) {
        button.classList.add('active');
      }
      button.addEventListener('click', function () {
        store.set('theme', button.getAttribute('data-value'));
        node.querySelectorAll('#themeSeg button').forEach(function (item) { item.classList.remove('active'); });
        button.classList.add('active');
        applyAppearance();
      });
    });

    var fontRange = node.querySelector('#fontRange');
    fontRange.addEventListener('input', function () {
      node.querySelector('#fontValue').textContent = fontRange.value + 'px';
      store.set('fontSize', Number(fontRange.value));
      document.documentElement.style.setProperty('--reader-size', fontRange.value + 'px');
    });

    node.querySelector('#imagesToggle').addEventListener('change', function (event) {
      store.set('images', event.target.checked);
      toast(event.target.checked ? '已开启正文图片' : '已开启无图模式');
    });
    node.querySelector('#expandToggle').addEventListener('change', function (event) {
      store.set('expandAnswers', event.target.checked);
    });
    node.querySelector('#loginBtn').addEventListener('click', async function () {
      if (api.session.signedIn) {
        await api.signOut();
        renderAccount();
        toast('已退出登录');
      } else {
        await signIn();
      }
      viewSettings();
    });
    node.querySelector('#openZhihu').addEventListener('click', function () {
      host.openPage('https://www.zhihu.com/').catch(function (error) { toast(error.message, 'error'); });
    });
    node.querySelector('#openData').addEventListener('click', function () {
      host.openDataFolder().catch(function (error) { toast(error.message, 'error'); });
    });
    node.querySelector('#clearHistory').addEventListener('click', function () {
      store.clearHistory();
      toast('已清空阅读记录');
    });
    setView(node);
  }

  // ---------------------------------------------------------------- routing

  function navigate(route) {
    if (global.location.hash === route) {
      render();
    } else {
      global.location.hash = route;
    }
  }

  function parseHash() {
    var raw = (global.location.hash || '#/hot').replace(/^#\/?/, '');
    var parts = raw.split('/');
    return { name: parts[0] || 'hot', rest: parts.slice(1) };
  }

  async function render(force) {
    var route = parseHash();
    currentRoute = route.name;
    if (force) {
      cache.clear();
    }
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.classList.toggle('active', item.getAttribute('data-route') === route.name);
    });
    back.hidden = !(route.name === 'q' || route.name === 'a' || route.name === 'art');

    if (route.name === 'q' && route.rest[0]) {
      return viewQuestion(route.rest[0]);
    }
    if (route.name === 'a' && route.rest[0]) {
      return viewAnswer(route.rest[0]);
    }
    if (route.name === 'art' && route.rest[0]) {
      return viewArticle(route.rest[0]);
    }
    if (route.name === 'search') {
      var query = decodeURIComponent(route.rest.join('/') || '');
      if (!query) {
        navigate('#/hot');
        return;
      }
      document.getElementById('searchInput').value = query;
      return viewSearch(query);
    }
    if (route.name === 'following') {
      return viewFollowing();
    }
    if (route.name === 'recommend') {
      return viewRecommend();
    }
    if (route.name === 'history') {
      requestToken += 1;
      return viewHistory();
    }
    if (route.name === 'settings') {
      requestToken += 1;
      return viewSettings();
    }
    return viewHot();
  }

  // ----------------------------------------------------------------- events

  global.addEventListener('hashchange', function () { render(); });

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-external]');
    if (link) {
      event.preventDefault();
      host.openExternal(link.getAttribute('href')).catch(function (error) { toast(error.message, 'error'); });
      return;
    }
    var internal = event.target.closest('a[href^="#/"]');
    if (internal) {
      // Let the browser handle hash navigation.
      return;
    }
    var card = event.target.closest('[data-route]');
    if (card && card.getAttribute('data-route')) {
      navigate(card.getAttribute('data-route'));
      return;
    }
    var slot = event.target.closest('.image-slot');
    if (slot) {
      var src = slot.getAttribute('data-src');
      if (src) {
        var image = document.createElement('img');
        image.src = src;
        image.loading = 'lazy';
        image.setAttribute('referrerpolicy', 'no-referrer');
        slot.replaceWith(image);
      }
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.target.closest('.card[data-route]')) {
      navigate(event.target.getAttribute('data-route'));
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      document.getElementById('searchInput').focus();
    }
    if (event.key === 'Escape' && document.activeElement === document.getElementById('searchInput')) {
      document.activeElement.blur();
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      global.history.back();
    }
  });

  document.getElementById('searchForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var input = document.getElementById('searchInput');
    var query = input.value.trim();
    if (!query) {
      return;
    }
    cache.delete('search:' + query);
    navigate('#/search/' + encodeURIComponent(query));
  });

  back.addEventListener('click', function () {
    if (global.history.length > 1) {
      global.history.back();
    } else {
      navigate('#/hot');
    }
  });

  document.getElementById('themeBtn').addEventListener('click', function () {
    store.set('theme', isDark() ? 'light' : 'dark');
    applyAppearance();
  });

  document.getElementById('browserBtn').addEventListener('click', function () {
    host.openPage('https://www.zhihu.com/').catch(function (error) { toast(error.message, 'error'); });
  });

  document.getElementById('account').addEventListener('click', async function () {
    if (api.session.signedIn) {
      await api.signOut();
      cache.clear();
      renderAccount();
      toast('已退出登录');
      render();
    } else {
      await signIn();
    }
  });

  // ------------------------------------------------------------------ boot

  (async function boot() {
    applyAppearance();
    renderAccount();
    try {
      await api.refreshSession();
      if (api.session.signedIn) {
        api.me().then(function (profile) {
          api.session.name = profile.name || '';
          api.session.avatar = profile.avatar_url || '';
          renderAccount();
        }).catch(function () {});
      }
    } catch (error) {
      // Anonymous session is fine.
    }
    if (!host.api) {
      toast('当前为浏览器预览模式：知乎接口会被跨域策略拦截，请使用桌面版', 'error');
    }
    await render();
    try {
      await host.metric('first-render', Math.round(performance.now()));
    } catch (error) {
      // Metrics are best effort.
    }
  })();
})(window);

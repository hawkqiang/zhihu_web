# NOTICE / 来源与许可

zhihu_web 是**非官方**的第三方客户端，与知乎（北京智者天下科技有限公司）不存在
隶属、授权或背书关系。所有内容版权归原作者与知乎所有，本程序只在本机显示这些
内容，不做再分发。

## 上游项目

- **知乎--（zhihu-minus-minus）** — https://github.com/huamurui/zhihu-minus-minus
  - License: GPL-3.0
  - 复用内容：知乎 Web 接口的调用方式、请求头约定、登录方案（内置浏览器完成登录、
    拦截会话 cookie）、`x-zse-96` 签名算法的移植来源。

## 签名算法

`src/web/js/zse96.js` 是 `src/api/zse96/zse_purity.ts` 的 JavaScript 移植，其算法
来自 zhi-purity 项目。原始代码与移植代码均以 GPL-3.0 分发。

## 第三方组件

- **Microsoft Edge WebView2 SDK** (`lib/webview2/`) — Microsoft Corporation，
  按其许可协议随附，见 `lib/webview2/LICENSE-WebView2SDK.txt`。
- **Microsoft Edge WebView2 Runtime** — 系统级 Evergreen 运行时，本程序不打包，
  只检测并复用。

## 本项目许可

GPL-3.0。完整许可文本见 `LICENSE`。

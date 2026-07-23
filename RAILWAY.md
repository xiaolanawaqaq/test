# Railway 部署三人联机（手把手）

这个项目已经按 Railway 配好了：`npm start` 会启动网页 + WebSocket 联机服务。

## 你需要准备

1. 一个 GitHub 账号（免费）
2. 一个 Railway 账号（免费额度够试玩）
3. 本机已装 Git（可选；也可用 Railway 网页上传）

---

## 方式 A：用 GitHub 部署（推荐）

### 1. 把项目推到 GitHub

在 `F:\tafangames` 目录：

```bash
git init
git add .
git commit -m "merge td multiplayer"
```

然后到 GitHub 新建一个空仓库（不要勾选 README），再：

```bash
git branch -M main
git remote add origin https://github.com/你的用户名/仓库名.git
git push -u origin main
```

### 2. 在 Railway 新建项目

1. 打开 [https://railway.app](https://railway.app) 登录
2. **New Project**
3. 选 **Deploy from GitHub repo**
4. 授权后选择你刚推的仓库
5. Railway 会自动识别 Node，并执行 `npm install` + `npm start`

### 3. 打开公网域名

1. 进这个服务页面
2. 点 **Settings** → **Networking** → **Generate Domain**
3. 会得到类似：

`https://merge-td-production-xxxx.up.railway.app`

### 4. 开始玩

| 页面 | 地址 |
|---|---|
| 单机 | `https://你的域名/` |
| 三人联机 | `https://你的域名/online.html` |

朋友各自手机打开联机页：
1. 一人点「创建房间」
2. 把房间码 / 邀请链接发给另外两人
3. 三人都「准备」→ 房主「开始游戏」

---

## 方式 B：Railway CLI（不经过 GitHub）

若你已登录 Railway CLI：

```bash
cd F:\tafangames
railway login
railway init
railway up
railway domain
```

---

## 常见问题

### 1. 打开页面是空白 / 502
- 等 1～2 分钟让服务启动
- 打开 Railway **Deployments** 看日志里是否有  
  `Merge TD multiplayer server listening on port ...`
- 访问 `https://你的域名/health` 应返回 `ok`

### 2. 联机页显示「连接服务器失败」
- 必须用 **https 域名**打开页面（不要用 http）
- WebSocket 会自动用 `wss://同一域名`，无需额外配置
- 确认服务在线、没有崩溃重启循环

### 3. 免费额度
- Railway 免费额度有限，试玩够用
- 服务闲置策略以 Railway 当前政策为准
- 不够用时再考虑付费或换 Render / 云服务器

### 4. 和 Cloudflare Pages 的关系
- **联机服务**放 Railway（这个项目）
- 单机也可以继续放 CF Pages，但联机不要拆开到 CF
- 建议三人联机直接用 Railway 同一个域名即可

---

## 本地再测一遍（可选）

```bash
cd F:\tafangames
npm install
npm start
```

浏览器打开：
- 单机：http://localhost:8787/
- 联机：http://localhost:8787/online.html

---

## 部署成功标志

1. `https://你的域名/health` → `ok`
2. `https://你的域名/online.html` 能打开大厅
3. 三个浏览器窗口能进同一房间并开始游戏

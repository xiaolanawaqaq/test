"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const {attachTransport} = require("./transport");

const root = path.resolve(__dirname,"..");
const port = Number(process.env.PORT || 8787);
const mime = {
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json",
  ".png":"image/png",
  ".svg":"image/svg+xml",
  ".ico":"image/x-icon",
};

// 不对外暴露的目录
const BLOCKED = new Set(["node_modules","server",".git",".railway"]);

function isBlocked(rel){
  const first = rel.split(/[\\/]/)[0];
  return BLOCKED.has(first);
}

const server=http.createServer((req,res)=>{
  // 健康检查（Railway 可用）
  if((req.url||"").split("?")[0]==="/health"){
    res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8"});
    res.end("ok");
    return;
  }

  const requestPath=(req.url||"/").split("?")[0];
  let relative=requestPath==="/"?"index.html":requestPath.replace(/^\/+/,"");
  // 兼容 /online 短路径
  if(relative==="online") relative="online.html";

  if(isBlocked(relative)){
    res.writeHead(404); res.end("Not found"); return;
  }

  const file=path.resolve(root,relative);
  if(file!==root && !file.startsWith(root+path.sep)){
    res.writeHead(403); res.end("Forbidden"); return;
  }

  fs.readFile(file,(err,data)=>{
    if(err){
      res.writeHead(404); res.end("Not found"); return;
    }
    res.writeHead(200,{
      "Content-Type":mime[path.extname(file)]||"application/octet-stream",
      "Cache-Control":"no-store",
    });
    res.end(data);
  });
});

attachTransport(server);
server.listen(port,"0.0.0.0",()=>{
  console.log(`Merge TD multiplayer server listening on port ${port}`);
});

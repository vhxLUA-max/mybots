const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");

test("Stockfish runs from extension origin via offscreen worker host",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
  const content=fs.readFileSync(path.join(root,"content.js"),"utf8");
  const background=fs.readFileSync(path.join(root,"background.js"),"utf8");
  const offscreen=fs.readFileSync(path.join(root,"offscreen.js"),"utf8");
  const html=fs.readFileSync(path.join(root,"offscreen.html"),"utf8");

  assert.equal(manifest.background.service_worker,"background.js");
  assert.equal(manifest.permissions.includes("offscreen"),true);
  assert.equal(manifest.web_accessible_resources,undefined);

  assert.equal(content.includes("new Worker(chrome.runtime.getURL(\"stockfish-19-lite-single.js\"))"),false);
  assert.equal(content.includes('chrome.runtime.sendMessage({'),true);
  assert.equal(content.includes("type:\"stockfishSearch\""),true);

  assert.equal(background.includes('reasons:["WORKERS"]'),true);
  assert.equal(background.includes('url:OFFSCREEN_DOCUMENT_PATH'),true);
  assert.equal(offscreen.includes('new Worker(chrome.runtime.getURL("stockfish-19-lite-single.js"))'),true);
  assert.equal(html.includes('<script src="offscreen.js"></script>'),true);

  for(const value of ["Maia","maia3","Polyglot","bookLookup","stockfish-worker.js"]){
    assert.equal(content.includes(value),false,value+" reference remains");
  }
});

test("Stockfish assets remain bundled",()=>{
  assert.equal(fs.existsSync(path.join(root,"stockfish-19-lite-single.js")),true);
  assert.equal(fs.existsSync(path.join(root,"stockfish-19-lite-single.wasm")),true);
  assert.ok(fs.statSync(path.join(root,"stockfish-19-lite-single.wasm")).size>1000000);
});

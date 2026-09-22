const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const root=path.resolve(__dirname,"..");

test("Stockfish-only manifest",()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.json"),"utf8"));
  assert.equal(manifest.background,undefined);
  assert.deepEqual(manifest.web_accessible_resources[0].resources,[
    "stockfish-19-lite-single.js",
    "stockfish-19-lite-single.wasm"
  ]);
  assert.equal(manifest.content_scripts.some(item=>item.js?.includes("player-side-main.js")),true);
  assert.equal(manifest.content_scripts.some(item=>item.js?.includes("content.js")),true);
});

test("Direct Stockfish UCI integration",()=>{
  const content=fs.readFileSync(path.join(root,"content.js"),"utf8");
  assert.equal(content.includes('new Worker(chrome.runtime.getURL("stockfish-19-lite-single.js"))'),true);
  assert.equal(content.includes('postMessage("uci")'),true);
  assert.equal(content.includes("position fen"),true);
  assert.equal(content.includes("go depth"),true);
  assert.equal(content.includes("bestmove"),true);
  assert.equal(content.includes("Stockfish 19 Lite Single"),true);
  for(const value of ["Maia","maia3","Polyglot","bookLookup","engine-worker.js","stockfish-worker.js"]){
    assert.equal(content.includes(value),false,value+" reference remains");
  }
});

test("Bundled Stockfish assets exist",()=>{
  const jsPath=path.join(root,"stockfish-19-lite-single.js");
  const wasmPath=path.join(root,"stockfish-19-lite-single.wasm");
  assert.equal(fs.existsSync(jsPath),true);
  assert.equal(fs.existsSync(wasmPath),true);
  assert.ok(fs.statSync(wasmPath).size>1000000);
});

test("Popup and dashboard are Stockfish-only",()=>{
  for(const file of ["popup.html","dashboard.html"]){
    const html=fs.readFileSync(path.join(root,file),"utf8");
    assert.equal(html.includes("STOCKFISH 19 CHESS ANALYSIS"),true);
    assert.equal(/Maia|Polyglot|Opening book|Human mode|Engine selector/i.test(html),false);
  }
});

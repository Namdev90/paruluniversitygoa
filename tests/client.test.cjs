const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
test('a failed forced-region request retries future calls with automatic region selection',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window,seen=[];
 w.fetch=async(url)=>{seen.push(url);return new Response(JSON.stringify(seen.length===1?{ok:false,error:'Region unavailable'}:{ok:true,googleEnabled:false}),{status:seen.length===1?503:200,headers:{'Content-Type':'application/json'}})};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{await assert.rejects(w.GateClient.api('config'),/Region unavailable/);await w.GateClient.api('config');assert.ok(seen[0].includes('forceFunctionRegion=ap-south-1'));assert.equal(seen[1].includes('forceFunctionRegion'),false)}finally{w.close()}
});

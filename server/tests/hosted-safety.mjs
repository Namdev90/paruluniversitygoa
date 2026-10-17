// The hosted suite replaces data and creates admissions. Keep its guard outside
// t.test(): a failed subtest does not stop Node from running later subtests.
const productionProject='mzesveurjzxjybkejqmx';
export function validateHostedTarget(api,permission){
 if(!api)throw Error('Set NAVRANG_TEST_API to a separate, disposable test project.');
 const url=new URL(api);
 if(url.hostname.toLowerCase().split('.').includes(productionProject))throw Error('Refusing hosted mutations against the live Navrang event.');
 if(permission!=='isolated-project')throw Error('Set NAVRANG_TEST_ALLOW_MUTATIONS=isolated-project only for a disposable, empty project.');
 if(url.username||url.password||url.search||url.hash)throw Error('Use a plain test API URL without credentials, query or fragment.');
 if(url.protocol!=='https:'&&!(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.protocol==='http:'))throw Error('Test API must use HTTPS, except on localhost.');
 return url;
}
export function assertEmptyHostedProject(response){
 const data=response?.body;
 if(response?.status!==200||data?.ok!==true||data?.stats?.total!==0||data?.stats?.admitted!==0||
    !Array.isArray(data.records)||data.records.length!==0||!Array.isArray(data.entries)||data.entries.length!==0||data.hasMore!==false){
  throw Error('Refusing hosted mutations: the admin response must prove the test project has no registrations or admissions.');
 }
}
